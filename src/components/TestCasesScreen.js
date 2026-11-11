import React, { useState, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';

export default function TestCasesScreen({
  subTab: controlledSubTab,
  onChangeSubTab,
}) {
  const { colors } = useTheme();
  const {
    activeProject,
    testPlan,
    suites,
    suiteCategories,
    testCases,
    priorities,
    testTypes,
    executionStatuses,
    selectedTestCaseId,
    setSelectedTestCaseId,
    testCasesSubTab: contextSubTab,
    setTestCasesSubTab: setContextSubTab,
    isSyncingProjectData,
    projectDataError,
    projectDataConflict,
    clearProjectDataError,
    reloadProjectDataFromBackend,
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
    showToast,
  } = useWorkspace();

  // Top-level Phase 2C sub-navigation: 'cases' | 'suites' | 'plan' (Synchronized with centralized navigation state)
  const [localSubTab, setLocalSubTab] = useState(
    controlledSubTab || contextSubTab || 'cases'
  );
  const subTab =
    controlledSubTab !== undefined
      ? controlledSubTab
      : contextSubTab !== undefined
      ? contextSubTab
      : localSubTab;

  const setSubTab = (nextTab) => {
    const cleanTab =
      nextTab === 'suites' || nextTab === 'plan' ? nextTab : 'cases';
    setLocalSubTab(cleanTab);
    if (typeof onChangeSubTab === 'function') {
      onChangeSubTab(cleanTab);
    }
    if (typeof setContextSubTab === 'function') {
      setContextSubTab(cleanTab);
    }
  };

  // --- Filter & Search State (Test Cases) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSuiteId, setSelectedSuiteId] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');

  // --- Test Case Create / Edit Modal State ---
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formSuiteId, setFormSuiteId] = useState(
    suites[0]?.id || 'suite-general'
  );
  const [formPriority, setFormPriority] = useState('P1');
  const [formTestType, setFormTestType] = useState('Functional');
  const [formTags, setFormTags] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPreconditions, setFormPreconditions] = useState('');
  const [formExpectedResult, setFormExpectedResult] = useState('');
  const [formSteps, setFormSteps] = useState([
    { action: '', testData: '', expectedResult: '' },
  ]);
  const [caseFormError, setCaseFormError] = useState(null);
  const [isSubmittingCase, setIsSubmittingCase] = useState(false);
  const caseSubmitLockRef = useRef(false);

  // --- Move Test Case Between Suites Modal State ---
  const [movingCase, setMovingCase] = useState(null);
  const [moveTargetSuiteId, setMoveTargetSuiteId] = useState('');
  const [isMovingCase, setIsMovingCase] = useState(false);

  // --- Delete Test Case Confirmation Modal State ---
  const [deletingCase, setDeletingCase] = useState(null);
  const [isDeletingCase, setIsDeletingCase] = useState(false);

  // --- Test Suite Create / Edit Modal State ---
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
  const [editingSuite, setEditingSuite] = useState(null);
  const [suiteNameInput, setSuiteNameInput] = useState('');
  const [suiteDescInput, setSuiteDescInput] = useState('');
  const [suiteCategoryInput, setSuiteCategoryInput] = useState('Functional');
  const [suitePhaseIdInput, setSuitePhaseIdInput] = useState('');
  const [suiteTagsInput, setSuiteTagsInput] = useState('');
  const [suiteFormError, setSuiteFormError] = useState(null);
  const [isSubmittingSuite, setIsSubmittingSuite] = useState(false);
  const suiteSubmitLockRef = useRef(false);

  // --- Delete Test Suite Confirmation Modal State ---
  const [deletingSuite, setDeletingSuite] = useState(null);
  const [suiteDeleteMode, setSuiteDeleteMode] = useState('move'); // 'move' | 'delete'
  const [suiteDeleteTargetId, setSuiteDeleteTargetId] = useState('');
  const [isDeletingSuite, setIsDeletingSuite] = useState(false);

  // --- Test Plan Edit Modal State ---
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [planForm, setPlanForm] = useState({
    name: '',
    description: '',
    objective: '',
    scope: '',
    outOfScope: '',
    strategy: '',
    environment: '',
    entryCriteria: '',
    exitCriteria: '',
    deliverables: '',
    risks: '',
    tools: '',
    schedule: '',
    approvals: '',
    notes: '',
  });
  const [planFormError, setPlanFormError] = useState(null);
  const [isSubmittingPlan, setIsSubmittingPlan] = useState(false);
  const planSubmitLockRef = useRef(false);

  // --- Testing Phase Create / Edit / Delete Modal State ---
  const [isPhaseModalOpen, setIsPhaseModalOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState(null);
  const [phaseNameInput, setPhaseNameInput] = useState('');
  const [phaseDescInput, setPhaseDescInput] = useState('');
  const [phaseFormError, setPhaseFormError] = useState(null);
  const [isSubmittingPhase, setIsSubmittingPhase] = useState(false);
  const [deletingPhase, setDeletingPhase] = useState(null);
  const [isDeletingPhase, setIsDeletingPhase] = useState(false);

  const selectedTestCase = useMemo(
    () =>
      testCases.find(
        (tc) =>
          tc.id === selectedTestCaseId || tc.testCaseId === selectedTestCaseId
      ) || null,
    [testCases, selectedTestCaseId]
  );

  const planPhases = useMemo(
    () => (Array.isArray(testPlan?.phases) ? testPlan.phases : []),
    [testPlan]
  );

  // Per-suite actual test case counts & status breakdown
  const suiteStatsMap = useMemo(() => {
    const map = {};
    suites.forEach((s) => {
      map[s.id] = {
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        untested: 0,
      };
    });
    testCases.forEach((tc) => {
      if (!map[tc.suiteId]) {
        map[tc.suiteId] = {
          total: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
          untested: 0,
        };
      }
      map[tc.suiteId].total += 1;
      if (tc.lastStatus === 'Passed') map[tc.suiteId].passed += 1;
      else if (tc.lastStatus === 'Failed') map[tc.suiteId].failed += 1;
      else if (tc.lastStatus === 'Blocked') map[tc.suiteId].blocked += 1;
      else map[tc.suiteId].untested += 1;
    });
    return map;
  }, [suites, testCases]);

  const filteredTestCases = useMemo(() => {
    return testCases.filter((tc) => {
      if (selectedSuiteId !== 'all' && tc.suiteId !== selectedSuiteId) {
        return false;
      }
      if (selectedPriority !== 'all' && tc.priority !== selectedPriority) {
        return false;
      }
      if (selectedStatus !== 'all' && tc.lastStatus !== selectedStatus) {
        return false;
      }
      if (
        selectedType !== 'all' &&
        tc.testType !== selectedType &&
        tc.category !== selectedType
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const tagMatch =
          Array.isArray(tc.tags) &&
          tc.tags.some((t) => t.toLowerCase().includes(q));
        const matchId = (tc.testCaseId || tc.id || '')
          .toLowerCase()
          .includes(q);
        const matchTitle = (tc.title || '').toLowerCase().includes(q);
        const matchDesc = (tc.description || '').toLowerCase().includes(q);
        const matchSuite = (tc.suiteName || '').toLowerCase().includes(q);
        return matchId || matchTitle || matchDesc || matchSuite || tagMatch;
      }
      return true;
    });
  }, [
    testCases,
    selectedSuiteId,
    selectedPriority,
    selectedStatus,
    selectedType,
    searchQuery,
  ]);

  const getPriorityBadgeStyle = (priority) => {
    switch (priority) {
      case 'P0':
      case 'Critical':
        return {
          bg: colors.dangerSoft,
          text: colors.danger,
          border: colors.danger,
        };
      case 'P1':
      case 'High':
        return {
          bg: colors.warningSoft,
          text: colors.warning,
          border: colors.warning,
        };
      case 'P2':
      case 'Medium':
        return {
          bg: colors.primarySoft,
          text: colors.primary,
          border: colors.primary,
        };
      default:
        return {
          bg: colors.surfaceMuted,
          text: colors.textSecondary,
          border: colors.border,
        };
    }
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'Passed':
        return { bg: colors.successSoft, text: colors.success };
      case 'Failed':
        return { bg: colors.dangerSoft, text: colors.danger };
      case 'Blocked':
        return { bg: colors.warningSoft, text: colors.warning };
      default:
        return { bg: colors.surfaceMuted, text: colors.textMuted };
    }
  };

  // =========================================================================
  // TEST CASE MODAL HANDLERS
  // =========================================================================

  const openCreateCaseModal = (defaultSuiteId = null) => {
    setEditingCase(null);
    setFormTitle('');
    setFormSuiteId(
      defaultSuiteId ||
        (selectedSuiteId !== 'all'
          ? selectedSuiteId
          : suites[0]?.id || 'suite-general')
    );
    setFormPriority('P1');
    setFormTestType('Functional');
    setFormTags('');
    setFormDescription('');
    setFormPreconditions('');
    setFormExpectedResult('');
    setFormSteps([{ action: '', testData: '', expectedResult: '' }]);
    setCaseFormError(null);
    setIsFormModalOpen(true);
  };

  const openEditCaseModal = (tc) => {
    setEditingCase(tc);
    setFormTitle(tc.title || '');
    setFormSuiteId(tc.suiteId || suites[0]?.id || 'suite-general');
    setFormPriority(tc.priority || 'P1');
    setFormTestType(tc.testType || tc.category || 'Functional');
    setFormTags(Array.isArray(tc.tags) ? tc.tags.join(', ') : '');
    setFormDescription(tc.description || '');
    setFormPreconditions(tc.preconditions || '');
    setFormExpectedResult(tc.expectedResult || '');
    setFormSteps(
      tc.steps && tc.steps.length > 0
        ? tc.steps.map((s) => ({
            action: s.action || '',
            testData: s.testData || '',
            expectedResult: s.expectedResult || '',
          }))
        : [{ action: '', testData: '', expectedResult: '' }]
    );
    setCaseFormError(null);
    setIsFormModalOpen(true);
  };

  const handleStepChange = (index, field, value) => {
    setFormSteps((prev) =>
      prev.map((step, idx) =>
        idx === index ? { ...step, [field]: value } : step
      )
    );
  };

  const addStepRow = () => {
    setFormSteps((prev) => [
      ...prev,
      { action: '', testData: '', expectedResult: '' },
    ]);
  };

  const removeStepRow = (index) => {
    if (formSteps.length <= 1) return;
    setFormSteps((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveTestCase = async () => {
    if (caseSubmitLockRef.current || isSubmittingCase) return;

    const trimmedTitle = formTitle.trim();
    if (!trimmedTitle) {
      setCaseFormError('Test case title is required.');
      return;
    }

    const parsedTags = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    caseSubmitLockRef.current = true;
    setIsSubmittingCase(true);
    setCaseFormError(null);

    try {
      let res;
      if (editingCase) {
        res = await updateTestCase(editingCase.id, {
          title: trimmedTitle,
          suiteId: formSuiteId,
          priority: formPriority,
          testType: formTestType,
          category: formTestType,
          tags: parsedTags,
          description: formDescription,
          preconditions: formPreconditions,
          expectedResult: formExpectedResult,
          steps: formSteps,
        });
      } else {
        res = await createTestCase({
          title: trimmedTitle,
          suiteId: formSuiteId,
          priority: formPriority,
          testType: formTestType,
          category: formTestType,
          tags: parsedTags,
          description: formDescription,
          preconditions: formPreconditions,
          expectedResult: formExpectedResult,
          steps: formSteps,
        });
      }

      if (res && res.ok) {
        setIsFormModalOpen(false);
        setEditingCase(null);
      } else {
        setCaseFormError(
          (res && res.error) || 'Failed to save test case to server.'
        );
      }
    } finally {
      caseSubmitLockRef.current = false;
      setIsSubmittingCase(false);
    }
  };

  const openMoveCaseModal = (tc) => {
    const otherSuite = suites.find((s) => s.id !== tc.suiteId) || suites[0];
    setMovingCase(tc);
    setMoveTargetSuiteId(otherSuite ? otherSuite.id : tc.suiteId);
  };

  const handleConfirmMoveCase = async () => {
    if (!movingCase || !moveTargetSuiteId || isMovingCase) return;
    if (moveTargetSuiteId === movingCase.suiteId) {
      setMovingCase(null);
      return;
    }
    setIsMovingCase(true);
    try {
      const res = await moveTestCaseToSuite(movingCase.id, moveTargetSuiteId);
      if (res && res.ok) {
        setMovingCase(null);
      }
    } finally {
      setIsMovingCase(false);
    }
  };

  const handleConfirmDeleteCase = async () => {
    if (!deletingCase || isDeletingCase) return;
    setIsDeletingCase(true);
    try {
      const res = await deleteTestCase(deletingCase.id);
      if (res && res.ok) {
        setDeletingCase(null);
      }
    } finally {
      setIsDeletingCase(false);
    }
  };

  // =========================================================================
  // TEST SUITE MODAL HANDLERS
  // =========================================================================

  const openCreateSuiteModal = () => {
    setEditingSuite(null);
    setSuiteNameInput('');
    setSuiteDescInput('');
    setSuiteCategoryInput('Functional');
    setSuitePhaseIdInput(planPhases[0]?.id || '');
    setSuiteTagsInput('');
    setSuiteFormError(null);
    setIsSuiteModalOpen(true);
  };

  const openEditSuiteModal = (suite) => {
    setEditingSuite(suite);
    setSuiteNameInput(suite.name || '');
    setSuiteDescInput(suite.description || '');
    setSuiteCategoryInput(suite.category || 'Functional');
    setSuitePhaseIdInput(suite.phaseId || '');
    setSuiteTagsInput(Array.isArray(suite.tags) ? suite.tags.join(', ') : '');
    setSuiteFormError(null);
    setIsSuiteModalOpen(true);
  };

  const handleSaveSuite = async () => {
    if (suiteSubmitLockRef.current || isSubmittingSuite) return;
    const trimmedName = suiteNameInput.trim();
    if (!trimmedName) {
      setSuiteFormError('Suite name is required.');
      return;
    }

    const parsedTags = suiteTagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    suiteSubmitLockRef.current = true;
    setIsSubmittingSuite(true);
    setSuiteFormError(null);

    try {
      let res;
      if (editingSuite) {
        res = await updateSuite(editingSuite.id, {
          name: trimmedName,
          description: suiteDescInput,
          category: suiteCategoryInput,
          phaseId: suitePhaseIdInput || null,
          tags: parsedTags,
        });
      } else {
        res = await createSuite({
          name: trimmedName,
          description: suiteDescInput,
          category: suiteCategoryInput,
          phaseId: suitePhaseIdInput || null,
          tags: parsedTags,
        });
      }

      if (res && res.ok) {
        if (!editingSuite && res.suite) {
          setSelectedSuiteId(res.suite.id);
        }
        setIsSuiteModalOpen(false);
        setEditingSuite(null);
      } else {
        setSuiteFormError(
          (res && res.error) || 'Failed to save test suite to server.'
        );
      }
    } finally {
      suiteSubmitLockRef.current = false;
      setIsSubmittingSuite(false);
    }
  };

  const openDeleteSuiteConfirm = (suite) => {
    const otherSuites = suites.filter((s) => s.id !== suite.id);
    const caseCount = suiteStatsMap[suite.id]?.total || 0;
    setDeletingSuite(suite);
    if (caseCount > 0 && otherSuites.length > 0) {
      setSuiteDeleteMode('move');
      setSuiteDeleteTargetId(otherSuites[0].id);
    } else {
      setSuiteDeleteMode('delete');
      setSuiteDeleteTargetId('');
    }
  };

  const handleConfirmDeleteSuite = async () => {
    if (!deletingSuite || isDeletingSuite) return;
    setIsDeletingSuite(true);
    try {
      const targetId = deletingSuite.id;
      const moveCasesToSuiteId =
        suiteDeleteMode === 'move' && suiteDeleteTargetId
          ? suiteDeleteTargetId
          : null;
      const res = await deleteSuite(targetId, { moveCasesToSuiteId });
      if (res && res.ok) {
        if (selectedSuiteId === targetId) {
          setSelectedSuiteId(moveCasesToSuiteId || 'all');
        }
        setDeletingSuite(null);
      }
    } finally {
      setIsDeletingSuite(false);
    }
  };

  // =========================================================================
  // TEST PLAN & PHASE MODAL HANDLERS
  // =========================================================================

  const openEditPlanModal = () => {
    setPlanForm({
      name:
        testPlan?.name ||
        `${activeProject?.name || 'Project'} Master Test Plan`,
      description: testPlan?.description || '',
      objective: testPlan?.objective || '',
      scope: testPlan?.scope || '',
      outOfScope: testPlan?.outOfScope || '',
      strategy: testPlan?.strategy || '',
      environment:
        testPlan?.environment || activeProject?.environment || '',
      entryCriteria: testPlan?.entryCriteria || '',
      exitCriteria: testPlan?.exitCriteria || '',
      deliverables: testPlan?.deliverables || '',
      risks: testPlan?.risks || '',
      tools: testPlan?.tools || '',
      schedule: testPlan?.schedule || '',
      approvals: testPlan?.approvals || '',
      notes: testPlan?.notes || '',
    });
    setPlanFormError(null);
    setIsPlanModalOpen(true);
  };

  const handlePlanFieldChange = (field, value) => {
    setPlanForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSavePlan = async () => {
    if (planSubmitLockRef.current || isSubmittingPlan) return;
    if (!planForm.name || !planForm.name.trim()) {
      setPlanFormError('Test Plan name is required.');
      return;
    }

    planSubmitLockRef.current = true;
    setIsSubmittingPlan(true);
    setPlanFormError(null);

    try {
      const res = await saveTestPlan(planForm);
      if (res && res.ok) {
        setIsPlanModalOpen(false);
      } else {
        setPlanFormError(
          (res && res.error) || 'Failed to save test plan to server.'
        );
      }
    } finally {
      planSubmitLockRef.current = false;
      setIsSubmittingPlan(false);
    }
  };

  const openCreatePhaseModal = () => {
    setEditingPhase(null);
    setPhaseNameInput('');
    setPhaseDescInput('');
    setPhaseFormError(null);
    setIsPhaseModalOpen(true);
  };

  const openEditPhaseModal = (phase) => {
    setEditingPhase(phase);
    setPhaseNameInput(phase.name || '');
    setPhaseDescInput(phase.description || '');
    setPhaseFormError(null);
    setIsPhaseModalOpen(true);
  };

  const handleSavePhase = async () => {
    if (isSubmittingPhase) return;
    if (!phaseNameInput.trim()) {
      setPhaseFormError('Phase name is required.');
      return;
    }
    setIsSubmittingPhase(true);
    setPhaseFormError(null);
    try {
      let res;
      if (editingPhase) {
        res = await updateTestPlanPhase(editingPhase.id, {
          name: phaseNameInput,
          description: phaseDescInput,
        });
      } else {
        res = await addTestPlanPhase({
          name: phaseNameInput,
          description: phaseDescInput,
        });
      }
      if (res && res.ok) {
        setIsPhaseModalOpen(false);
        setEditingPhase(null);
      } else {
        setPhaseFormError((res && res.error) || 'Failed to save phase.');
      }
    } finally {
      setIsSubmittingPhase(false);
    }
  };

  const handleConfirmDeletePhase = async () => {
    if (!deletingPhase || isDeletingPhase) return;
    setIsDeletingPhase(true);
    try {
      const res = await deleteTestPlanPhase(deletingPhase.id);
      if (res && res.ok) {
        setDeletingPhase(null);
      }
    } finally {
      setIsDeletingPhase(false);
    }
  };

  // Plan documentation sections for clean rendering
  const planDocSections = useMemo(() => {
    if (!testPlan) return [];
    return [
      { key: 'description', label: 'Plan Overview & Description', value: testPlan.description },
      { key: 'objective', label: 'Testing Objectives', value: testPlan.objective },
      { key: 'scope', label: 'In Scope', value: testPlan.scope },
      { key: 'outOfScope', label: 'Out of Scope', value: testPlan.outOfScope },
      { key: 'strategy', label: 'Test Strategy & Approach', value: testPlan.strategy },
      { key: 'environment', label: 'Test Environment & Infrastructure', value: testPlan.environment },
      { key: 'entryCriteria', label: 'Entry Criteria', value: testPlan.entryCriteria },
      { key: 'exitCriteria', label: 'Exit Criteria', value: testPlan.exitCriteria },
      { key: 'deliverables', label: 'QA Deliverables', value: testPlan.deliverables },
      { key: 'risks', label: 'Risks & Mitigation', value: testPlan.risks },
      { key: 'tools', label: 'Tools & Automation Stack', value: testPlan.tools },
      { key: 'schedule', label: 'Schedule & Milestones', value: testPlan.schedule },
      { key: 'approvals', label: 'Sign-off & Approvals', value: testPlan.approvals },
      { key: 'notes', label: 'Additional Notes', value: testPlan.notes },
    ];
  }, [testPlan]);

  const populatedPlanSections = useMemo(
    () => planDocSections.filter((s) => s.value && String(s.value).trim()),
    [planDocSections]
  );

  return (
    <View style={styles.container}>
      {/* Top Active Project Bar + Sync Status + Segmented Sub-Navigation */}
      <View
        style={[
          styles.topSubNavWrap,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.projectContextRow}>
          <View style={styles.projectContextLeft}>
            <VectorIcon name="folder" size={14} color={colors.primary} />
            <Text
              style={[styles.projectContextName, { color: colors.text }]}
              numberOfLines={1}
            >
              {activeProject?.name || 'Active Project'}
            </Text>
          </View>
          <View style={styles.syncStatusRight}>
            {isSyncingProjectData ? (
              <View
                style={[
                  styles.syncPill,
                  { backgroundColor: colors.primarySoft, borderColor: colors.primary },
                ]}
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.syncPillText, { color: colors.primary }]}>
                  Syncing...
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={reloadProjectDataFromBackend}
                style={({ pressed }) => [
                  styles.syncPill,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <VectorIcon name="refresh" size={12} color={colors.textSecondary} />
                <Text
                  style={[styles.syncPillText, { color: colors.textSecondary }]}
                >
                  Sync
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* 3-Tab Segmented Switcher: Test Cases | Test Suites | Test Plan */}
        <View
          style={[
            styles.segmentedBar,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
          ]}
        >
          {[
            {
              key: 'cases',
              label: `Cases (${testCases.length})`,
              icon: 'layers',
            },
            {
              key: 'suites',
              label: `Suites (${suites.length})`,
              icon: 'folder',
            },
            {
              key: 'plan',
              label: `Test Plan`,
              icon: 'info',
            },
          ].map((tab) => {
            const active = subTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setSubTab(tab.key)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tab.label}
                style={[
                  styles.segmentBtn,
                  active && {
                    backgroundColor: colors.primary,
                  },
                ]}
              >
                <VectorIcon
                  name={tab.icon}
                  size={13}
                  color={active ? '#ffffff' : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.segmentBtnText,
                    { color: active ? '#ffffff' : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Error / HTTP 409 Optimistic Concurrency Conflict Banner */}
        {(projectDataError || projectDataConflict) && (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <View style={styles.errorBannerTop}>
              <VectorIcon name="alert" size={16} color={colors.danger} />
              <Text style={[styles.errorBannerText, { color: colors.danger }]}>
                {projectDataConflict
                  ? projectDataConflict.message
                  : projectDataError}
              </Text>
            </View>
            <View style={styles.errorBannerActions}>
              <Pressable
                onPress={reloadProjectDataFromBackend}
                style={[
                  styles.errorBannerBtn,
                  { backgroundColor: colors.danger },
                ]}
              >
                <Text style={styles.errorBannerBtnText}>
                  Reload Latest from Server
                </Text>
              </Pressable>
              <Pressable
                onPress={clearProjectDataError}
                style={[
                  styles.errorBannerBtnOutline,
                  { borderColor: colors.danger },
                ]}
              >
                <Text
                  style={[
                    styles.errorBannerBtnOutlineText,
                    { color: colors.danger },
                  ]}
                >
                  Dismiss
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* ===================================================================
          SUB-VIEW 1: TEST CASES
         =================================================================== */}
      {subTab === 'cases' && (
        <>
          <View
            style={[
              styles.topSearchWrap,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.searchBarRow}>
              <View
                style={[
                  styles.searchInputBox,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <VectorIcon name="search" size={15} color={colors.textMuted} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search ID, title, suite, tag..."
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Search test cases by ID, title, suite, or tag"
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {searchQuery.length > 0 && (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear test case search"
                  >
                    <VectorIcon
                      name="close"
                      size={14}
                      color={colors.textMuted}
                    />
                  </Pressable>
                )}
              </View>
              <Pressable
                onPress={() => openCreateCaseModal()}
                accessibilityRole="button"
                accessibilityLabel="Create New Test Case"
                style={({ pressed }) => [
                  styles.addCaseBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <VectorIcon name="plus" size={14} color="#ffffff" />
                <Text style={styles.addCaseBtnText}>New Case</Text>
              </Pressable>
            </View>

            {/* Suite Filter Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suiteScrollContent}
            >
              <Pressable
                onPress={() => setSelectedSuiteId('all')}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedSuiteId === 'all' }}
                accessibilityLabel={`All Suites (${testCases.length})`}
                style={[
                  styles.suiteChip,
                  {
                    backgroundColor:
                      selectedSuiteId === 'all'
                        ? colors.primary
                        : colors.surfaceMuted,
                    borderColor:
                      selectedSuiteId === 'all' ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.suiteChipText,
                    {
                      color:
                        selectedSuiteId === 'all'
                          ? '#ffffff'
                          : colors.textSecondary,
                    },
                  ]}
                >
                  All Suites ({testCases.length})
                </Text>
              </Pressable>

              {suites.map((suite) => {
                const count = suiteStatsMap[suite.id]?.total || 0;
                const active = selectedSuiteId === suite.id;
                return (
                  <Pressable
                    key={suite.id}
                    onPress={() => setSelectedSuiteId(suite.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter by suite: ${suite.name} (${count} cases)`}
                    style={[
                      styles.suiteChip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.surfaceMuted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.suiteChipText,
                        { color: active ? '#ffffff' : colors.textSecondary },
                      ]}
                    >
                      {suite.name} ({count})
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable
                onPress={openCreateSuiteModal}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Create New Test Suite"
                style={[
                  styles.suiteChip,
                  {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Text style={[styles.suiteChipText, { color: colors.primary }]}>
                  + Suite
                </Text>
              </Pressable>
            </ScrollView>

            {/* Priority & Status Filter Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRowContent}
            >
              {['all', ...priorities].map((p) => {
                const active = selectedPriority === p;
                return (
                  <Pressable
                    key={`prio-${p}`}
                    onPress={() => setSelectedPriority(p)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter by priority: ${
                      p === 'all' ? 'All Priority' : p
                    }`}
                    style={[
                      styles.miniFilterChip,
                      {
                        backgroundColor: active
                          ? colors.primarySoft
                          : 'transparent',
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniFilterText,
                        { color: active ? colors.primary : colors.textMuted },
                      ]}
                    >
                      {p === 'all' ? 'All Priority' : p}
                    </Text>
                  </Pressable>
                );
              })}

              <View
                style={[
                  styles.filterDivider,
                  { backgroundColor: colors.border },
                ]}
              />

              {['all', ...executionStatuses].map((st) => {
                const active = selectedStatus === st;
                return (
                  <Pressable
                    key={`status-${st}`}
                    onPress={() => setSelectedStatus(st)}
                    style={[
                      styles.miniFilterChip,
                      {
                        backgroundColor: active
                          ? colors.primarySoft
                          : 'transparent',
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniFilterText,
                        { color: active ? colors.primary : colors.textMuted },
                      ]}
                    >
                      {st === 'all' ? 'All Status' : st}
                    </Text>
                  </Pressable>
                );
              })}

              <View
                style={[
                  styles.filterDivider,
                  { backgroundColor: colors.border },
                ]}
              />

              {['all', ...testTypes].map((tp) => {
                const active = selectedType === tp;
                return (
                  <Pressable
                    key={`type-${tp}`}
                    onPress={() => setSelectedType(tp)}
                    style={[
                      styles.miniFilterChip,
                      {
                        backgroundColor: active
                          ? colors.primarySoft
                          : 'transparent',
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniFilterText,
                        { color: active ? colors.primary : colors.textMuted },
                      ]}
                    >
                      {tp === 'all' ? 'All Types' : tp}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultsBar}>
              <Text style={[styles.resultsCount, { color: colors.textMuted }]}>
                Showing {filteredTestCases.length} of {testCases.length} test
                cases
              </Text>
              {(selectedSuiteId !== 'all' ||
                selectedPriority !== 'all' ||
                selectedStatus !== 'all' ||
                selectedType !== 'all' ||
                searchQuery.trim() !== '') && (
                <Pressable
                  onPress={() => {
                    setSelectedSuiteId('all');
                    setSelectedPriority('all');
                    setSelectedStatus('all');
                    setSelectedType('all');
                    setSearchQuery('');
                  }}
                >
                  <Text style={[styles.resetText, { color: colors.primary }]}>
                    Reset Filters
                  </Text>
                </Pressable>
              )}
            </View>

            {filteredTestCases.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <VectorIcon
                  name="layers"
                  size={28}
                  color={colors.primary}
                  style={{ marginBottom: 8 }}
                />
                <Text
                  style={[styles.emptyTitle, { color: colors.text }]}
                >
                  {testCases.length === 0
                    ? 'No Test Cases in This Project Yet'
                    : 'No Matching Test Cases'}
                </Text>
                <Text
                  style={[styles.emptySub, { color: colors.textSecondary }]}
                >
                  {testCases.length === 0
                    ? 'Create your first test case with preconditions, test steps, and expected results.'
                    : 'Adjust your search query or filter criteria, or create a new test case.'}
                </Text>
                <Pressable
                  onPress={() => openCreateCaseModal()}
                  style={[
                    styles.emptyCta,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.emptyCtaText}>+ Create Test Case</Text>
                </Pressable>
              </View>
            ) : (
              filteredTestCases.map((tc) => {
                const prioStyle = getPriorityBadgeStyle(tc.priority);
                const statusStyle = getStatusBadgeStyle(tc.lastStatus);
                return (
                  <Pressable
                    key={tc.id}
                    onPress={() => setSelectedTestCaseId(tc.id)}
                    style={({ pressed }) => [
                      styles.caseCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        opacity: pressed ? 0.92 : 1,
                      },
                    ]}
                  >
                    <View style={styles.caseTopRow}>
                      <View style={styles.caseIdBadgeRow}>
                        <Text
                          style={[
                            styles.caseId,
                            {
                              color: colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {tc.testCaseId || tc.id}
                        </Text>
                        <View
                          style={[
                            styles.prioBadge,
                            {
                              backgroundColor: prioStyle.bg,
                              borderColor: prioStyle.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.prioBadgeText,
                              { color: prioStyle.text },
                            ]}
                          >
                            {tc.priority}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: statusStyle.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            { color: statusStyle.text },
                          ]}
                        >
                          {tc.lastStatus}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={[styles.caseTitle, { color: colors.text }]}
                    >
                      {tc.title}
                    </Text>

                    {!!tc.description && (
                      <Text
                        style={[
                          styles.caseDesc,
                          { color: colors.textSecondary },
                        ]}
                        numberOfLines={2}
                      >
                        {tc.description}
                      </Text>
                    )}

                    <View style={styles.caseFooterRow}>
                      <View style={styles.caseMetaRow}>
                        <View
                          style={[
                            styles.metaPill,
                            { backgroundColor: colors.surfaceMuted },
                          ]}
                        >
                          <Text
                            style={[
                              styles.metaPillText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {tc.suiteName}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.metaPill,
                            { backgroundColor: colors.surfaceMuted },
                          ]}
                        >
                          <Text
                            style={[
                              styles.metaPillText,
                              { color: colors.textMuted },
                            ]}
                          >
                            {tc.testType || tc.category}
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.stepsCountText,
                          { color: colors.textMuted },
                        ]}
                      >
                        {(tc.steps || []).length} steps
                      </Text>
                    </View>

                    {/* Quick Card Actions: Move Suite | Edit | Delete */}
                    <View
                      style={[
                        styles.cardActionsBar,
                        { borderTopColor: colors.border },
                      ]}
                    >
                      {suites.length > 1 && (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation?.();
                            openMoveCaseModal(tc);
                          }}
                          style={[
                            styles.cardMiniBtn,
                            {
                              backgroundColor: colors.surfaceMuted,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="switch"
                            size={12}
                            color={colors.textSecondary}
                          />
                          <Text
                            style={[
                              styles.cardMiniBtnText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            Move Suite
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          openEditCaseModal(tc);
                        }}
                        style={[
                          styles.cardMiniBtn,
                          {
                            backgroundColor: colors.surfaceMuted,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="edit"
                          size={12}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.cardMiniBtnText,
                            { color: colors.primary },
                          ]}
                        >
                          Edit
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setDeletingCase(tc);
                        }}
                        style={[
                          styles.cardMiniBtn,
                          {
                            backgroundColor: colors.dangerSoft,
                            borderColor: colors.danger,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="trash"
                          size={12}
                          color={colors.danger}
                        />
                        <Text
                          style={[
                            styles.cardMiniBtnText,
                            { color: colors.danger },
                          ]}
                        >
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      )}

      {/* ===================================================================
          SUB-VIEW 2: TEST SUITES
         =================================================================== */}
      {subTab === 'suites' && (
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.sectionBannerCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.sectionBannerTitle,
                  { color: colors.text },
                ]}
              >
                Test Suites ({suites.length})
              </Text>
              <Text
                style={[
                  styles.sectionBannerSub,
                  { color: colors.textSecondary },
                ]}
              >
                Organize project test cases into logical functional, regression,
                or security suites.
              </Text>
            </View>
            <Pressable
              onPress={openCreateSuiteModal}
              style={[
                styles.primaryActionBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <VectorIcon name="plus" size={14} color="#ffffff" />
              <Text style={styles.primaryActionBtnText}>New Suite</Text>
            </Pressable>
          </View>

          {suites.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <VectorIcon
                name="folder"
                size={28}
                color={colors.primary}
                style={{ marginBottom: 8 }}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No Test Suites Defined Yet
              </Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Create a test suite to organize your test cases by feature
                module or testing phase.
              </Text>
              <Pressable
                onPress={openCreateSuiteModal}
                style={[styles.emptyCta, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.emptyCtaText}>+ Create First Suite</Text>
              </Pressable>
            </View>
          ) : (
            suites.map((suite) => {
              const stats = suiteStatsMap[suite.id] || {
                total: 0,
                passed: 0,
                failed: 0,
                blocked: 0,
                untested: 0,
              };
              const linkedPhase = planPhases.find(
                (p) => p.id === suite.phaseId
              );
              return (
                <View
                  key={suite.id}
                  style={[
                    styles.suiteDetailCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.suiteDetailTop}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={styles.suiteBadgeRow}>
                        <View
                          style={[
                            styles.metaPill,
                            { backgroundColor: colors.primarySoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.metaPillText,
                              { color: colors.primary },
                            ]}
                          >
                            {suite.category || 'Functional'}
                          </Text>
                        </View>
                        {linkedPhase && (
                          <View
                            style={[
                              styles.metaPill,
                              { backgroundColor: colors.surfaceMuted },
                            ]}
                          >
                            <Text
                              style={[
                                styles.metaPillText,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Phase: {linkedPhase.name}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.suiteDetailName,
                          { color: colors.text },
                        ]}
                      >
                        {suite.name}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.caseCountBadge,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.caseCountNumber,
                          { color: colors.primary },
                        ]}
                      >
                        {stats.total}
                      </Text>
                      <Text
                        style={[
                          styles.caseCountLabel,
                          { color: colors.textMuted },
                        ]}
                      >
                        {stats.total === 1 ? 'Case' : 'Cases'}
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={[
                      styles.suiteDetailDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {suite.description || 'No suite description provided.'}
                  </Text>

                  {Array.isArray(suite.tags) && suite.tags.length > 0 && (
                    <View style={styles.suiteTagsRow}>
                      {suite.tags.map((tag, idx) => (
                        <View
                          key={`${suite.id}-tag-${idx}`}
                          style={[
                            styles.metaPill,
                            { backgroundColor: colors.surfaceMuted },
                          ]}
                        >
                          <Text
                            style={[
                              styles.metaPillText,
                              { color: colors.textMuted },
                            ]}
                          >
                            #{tag}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Suite Status Breakdown */}
                  <View
                    style={[
                      styles.suiteStatsRow,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Text
                      style={[styles.suiteStatItem, { color: colors.success }]}
                    >
                      Passed: {stats.passed}
                    </Text>
                    <Text
                      style={[styles.suiteStatItem, { color: colors.danger }]}
                    >
                      Failed: {stats.failed}
                    </Text>
                    <Text
                      style={[styles.suiteStatItem, { color: colors.warning }]}
                    >
                      Blocked: {stats.blocked}
                    </Text>
                    <Text
                      style={[
                        styles.suiteStatItem,
                        { color: colors.textMuted },
                      ]}
                    >
                      Untested: {stats.untested}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.cardActionsBar,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <Pressable
                      onPress={() => {
                        setSelectedSuiteId(suite.id);
                        setSubTab('cases');
                      }}
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: colors.primarySoft,
                          borderColor: colors.primary,
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
                          styles.cardMiniBtnText,
                          { color: colors.primary },
                        ]}
                      >
                        View Cases ({stats.total})
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => openCreateCaseModal(suite.id)}
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="plus"
                        size={12}
                        color={colors.text}
                      />
                      <Text
                        style={[
                          styles.cardMiniBtnText,
                          { color: colors.text },
                        ]}
                      >
                        Add Case
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => openEditSuiteModal(suite)}
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="edit"
                        size={12}
                        color={colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.cardMiniBtnText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Edit
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => openDeleteSuiteConfirm(suite)}
                      style={[
                        styles.cardMiniBtn,
                        {
                          backgroundColor: colors.dangerSoft,
                          borderColor: colors.danger,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="trash"
                        size={12}
                        color={colors.danger}
                      />
                      <Text
                        style={[
                          styles.cardMiniBtnText,
                          { color: colors.danger },
                        ]}
                      >
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ===================================================================
          SUB-VIEW 3: TEST PLAN
         =================================================================== */}
      {subTab === 'plan' && (
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Test Plan Master Header Card */}
          <View
            style={[
              styles.planHeaderCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.planHeaderTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={[
                    styles.planIdLabel,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  {testPlan?.id || `plan_${activeProject?.id || 'project'}`}
                </Text>
                <Text
                  style={[styles.planTitle, { color: colors.text }]}
                >
                  {testPlan?.name ||
                    `${activeProject?.name || 'Project'} Master Test Plan`}
                </Text>
              </View>
              <Pressable
                onPress={openEditPlanModal}
                style={[
                  styles.primaryActionBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <VectorIcon name="edit" size={14} color="#ffffff" />
                <Text style={styles.primaryActionBtnText}>Edit Plan</Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.planSummaryStrip,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <View style={styles.planMetricBox}>
                <Text
                  style={[styles.planMetricVal, { color: colors.text }]}
                >
                  {planPhases.length}
                </Text>
                <Text
                  style={[styles.planMetricLbl, { color: colors.textMuted }]}
                >
                  Phases
                </Text>
              </View>
              <View style={styles.planMetricBox}>
                <Text
                  style={[styles.planMetricVal, { color: colors.text }]}
                >
                  {suites.length}
                </Text>
                <Text
                  style={[styles.planMetricLbl, { color: colors.textMuted }]}
                >
                  Suites
                </Text>
              </View>
              <View style={styles.planMetricBox}>
                <Text
                  style={[styles.planMetricVal, { color: colors.text }]}
                >
                  {testCases.length}
                </Text>
                <Text
                  style={[styles.planMetricLbl, { color: colors.textMuted }]}
                >
                  Test Cases
                </Text>
              </View>
              <View style={styles.planMetricBox}>
                <Text style={[styles.planMetricVal, { color: colors.primary }]}>
                  {populatedPlanSections.length}/{planDocSections.length}
                </Text>
                <Text
                  style={[styles.planMetricLbl, { color: colors.textMuted }]}
                >
                  Sections
                </Text>
              </View>
            </View>
          </View>

          {/* Testing Phases Section (`testPlan.phases`) */}
          <View
            style={[
              styles.planSectionCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.planSectionHeader}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.planSectionTitle,
                    { color: colors.text },
                  ]}
                >
                  Testing Phases ({planPhases.length})
                </Text>
                <Text
                  style={[
                    styles.planSectionSub,
                    { color: colors.textSecondary },
                  ]}
                >
                  Define execution milestones (e.g. Smoke, Functional,
                  Regression, Release Gate).
                </Text>
              </View>
              <Pressable
                onPress={openCreatePhaseModal}
                style={[
                  styles.secondaryActionBtn,
                  {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <VectorIcon name="plus" size={12} color={colors.primary} />
                <Text
                  style={[
                    styles.secondaryActionBtnText,
                    { color: colors.primary },
                  ]}
                >
                  Add Phase
                </Text>
              </Pressable>
            </View>

            {planPhases.length === 0 ? (
              <View
                style={[
                  styles.inlineEmptyBox,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.inlineEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  No testing phases added yet. Add phases to structure your test
                  plan milestones.
                </Text>
              </View>
            ) : (
              planPhases.map((phase, idx) => {
                const phaseSuites = suites.filter(
                  (s) => s.phaseId === phase.id
                );
                const phaseCasesCount = phaseSuites.reduce(
                  (acc, s) => acc + (suiteStatsMap[s.id]?.total || 0),
                  0
                );
                return (
                  <View
                    key={phase.id}
                    style={[
                      styles.phaseRowCard,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.phaseOrderCircle,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text style={styles.phaseOrderText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={[
                          styles.phaseRowName,
                          { color: colors.text },
                        ]}
                      >
                        {phase.name}
                      </Text>
                      <Text
                        style={[
                          styles.phaseRowDesc,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {phase.description || 'No phase description'}
                      </Text>
                      <Text
                        style={[
                          styles.phaseRowStats,
                          { color: colors.textMuted },
                        ]}
                      >
                        {phaseSuites.length} suites · {phaseCasesCount} cases
                      </Text>
                    </View>
                    <View style={styles.phaseRowActions}>
                      <Pressable
                        onPress={() => openEditPhaseModal(phase)}
                        hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit testing phase ${phase.name}`}
                        style={[
                          styles.iconSquareBtn,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="edit"
                          size={13}
                          color={colors.primary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => setDeletingPhase(phase)}
                        hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete testing phase ${phase.name}`}
                        style={[
                          styles.iconSquareBtn,
                          {
                            backgroundColor: colors.dangerSoft,
                            borderColor: colors.danger,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="trash"
                          size={13}
                          color={colors.danger}
                        />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Test Plan Documentation & Criteria Sections */}
          <View
            style={[
              styles.planSectionCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.planSectionHeader}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.planSectionTitle,
                    { color: colors.text },
                  ]}
                >
                  Test Plan Specification
                </Text>
                <Text
                  style={[
                    styles.planSectionSub,
                    { color: colors.textSecondary },
                  ]}
                >
                  Objectives, scope, entry/exit criteria, environment, and
                  deliverables.
                </Text>
              </View>
            </View>

            {populatedPlanSections.length === 0 ? (
              <View
                style={[
                  styles.inlineEmptyBox,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.inlineEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  No test plan specification details have been authored yet. Tap
                  &quot;Edit Plan&quot; to document objectives, scope, strategy,
                  and criteria.
                </Text>
                <Pressable
                  onPress={openEditPlanModal}
                  style={[
                    styles.emptyCta,
                    { backgroundColor: colors.primary, marginTop: 8 },
                  ]}
                >
                  <Text style={styles.emptyCtaText}>
                    Author Test Plan Details
                  </Text>
                </Pressable>
              </View>
            ) : (
              planDocSections.map((sec) => {
                const hasVal = sec.value && String(sec.value).trim();
                return (
                  <View
                    key={sec.key}
                    style={[
                      styles.planDocBlock,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.planDocLabel,
                        { color: colors.textMuted },
                      ]}
                    >
                      {sec.label}
                    </Text>
                    <Text
                      style={[
                        styles.planDocValue,
                        {
                          color: hasVal
                            ? colors.text
                            : colors.textMuted,
                          fontStyle: hasVal ? 'normal' : 'italic',
                        },
                      ]}
                    >
                      {hasVal ? sec.value : 'Not specified'}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      {/* ===================================================================
          MODAL 1: TEST CASE DETAIL INSPECTION
         =================================================================== */}
      <Modal
        visible={!!selectedTestCase}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedTestCaseId(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {selectedTestCase && (
              <>
                <View
                  style={[
                    styles.modalHeader,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.modalIdRow}>
                      <Text
                        style={[
                          styles.modalCaseId,
                          {
                            color: colors.primary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {selectedTestCase.testCaseId || selectedTestCase.id}
                      </Text>
                      <Text
                        style={[
                          styles.modalSuiteName,
                          { color: colors.textMuted },
                        ]}
                      >
                        · {selectedTestCase.suiteName}
                      </Text>
                    </View>
                    <Text
                      accessibilityRole="header"
                      style={[
                        styles.modalTitle,
                        { color: colors.text },
                      ]}
                    >
                      {selectedTestCase.title}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setSelectedTestCaseId(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Close test case details"
                    style={[
                      styles.closeCircle,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <VectorIcon
                      name="close"
                      size={14}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.modalBody}
                  contentContainerStyle={styles.modalBodyContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Quick Status Selector */}
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.blockLabel, { color: colors.textMuted }]}
                    >
                      CURRENT EXECUTION STATUS
                    </Text>
                    <View style={styles.quickStatusRow}>
                      {executionStatuses.map((st) => {
                        const active = selectedTestCase.lastStatus === st;
                        const stStyle = getStatusBadgeStyle(st);
                        return (
                          <Pressable
                            key={st}
                            onPress={() =>
                              updateTestCase(selectedTestCase.id, {
                                lastStatus: st,
                              })
                            }
                            style={[
                              styles.quickStatusBtn,
                              {
                                backgroundColor: active
                                  ? stStyle.bg
                                  : colors.surfaceMuted,
                                borderColor: active
                                  ? stStyle.text
                                  : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.quickStatusText,
                                {
                                  color: active
                                    ? stStyle.text
                                    : colors.textSecondary,
                                },
                              ]}
                            >
                              {st}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Move Between Suites Selector inside Detail Modal */}
                  {suites.length > 1 && (
                    <View
                      style={[
                        styles.detailBlock,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.blockLabel, { color: colors.textMuted }]}
                      >
                        ASSIGNED TEST SUITE (TAP TO MOVE)
                      </Text>
                      <View style={styles.optionChipsWrap}>
                        {suites.map((s) => {
                          const isCurrent = s.id === selectedTestCase.suiteId;
                          return (
                            <Pressable
                              key={s.id}
                              onPress={() => {
                                if (!isCurrent) {
                                  moveTestCaseToSuite(
                                    selectedTestCase.id,
                                    s.id
                                  );
                                }
                              }}
                              style={[
                                styles.optionChip,
                                {
                                  backgroundColor: isCurrent
                                    ? colors.primary
                                    : colors.surfaceMuted,
                                  borderColor: isCurrent
                                    ? colors.primary
                                    : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.optionChipText,
                                  {
                                    color: isCurrent
                                      ? '#ffffff'
                                      : colors.textSecondary,
                                  },
                                ]}
                              >
                                {s.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Metadata Grid */}
                  <View style={styles.metaGrid}>
                    <View
                      style={[
                        styles.metaCell,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.metaCellLabel, { color: colors.textMuted }]}
                      >
                        Priority
                      </Text>
                      <Text
                        style={[
                          styles.metaCellValue,
                          { color: colors.text },
                        ]}
                      >
                        {selectedTestCase.priority}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.metaCell,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.metaCellLabel, { color: colors.textMuted }]}
                      >
                        Test Type
                      </Text>
                      <Text
                        style={[
                          styles.metaCellValue,
                          { color: colors.text },
                        ]}
                      >
                        {selectedTestCase.testType || selectedTestCase.category}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.metaCell,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.metaCellLabel, { color: colors.textMuted }]}
                      >
                        Updated
                      </Text>
                      <Text
                        style={[
                          styles.metaCellValue,
                          { color: colors.textSecondary, fontSize: 11 },
                        ]}
                      >
                        {selectedTestCase.updatedAt}
                      </Text>
                    </View>
                  </View>

                  {Array.isArray(selectedTestCase.tags) &&
                    selectedTestCase.tags.length > 0 && (
                      <View
                        style={[
                          styles.detailBlock,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.blockLabel,
                            { color: colors.textMuted },
                          ]}
                        >
                          TAGS
                        </Text>
                        <View style={styles.suiteTagsRow}>
                          {selectedTestCase.tags.map((t, idx) => (
                            <View
                              key={`tc-tag-${idx}`}
                              style={[
                                styles.metaPill,
                                { backgroundColor: colors.surfaceMuted },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.metaPillText,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                #{t}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                  {/* Preconditions & Description */}
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.blockLabel, { color: colors.textMuted }]}
                    >
                      PRECONDITIONS
                    </Text>
                    <Text
                      style={[styles.blockBody, { color: colors.text }]}
                    >
                      {selectedTestCase.preconditions ||
                        'Standard application state.'}
                    </Text>
                    {!!selectedTestCase.description && (
                      <>
                        <Text
                          style={[
                            styles.blockLabel,
                            { color: colors.textMuted, marginTop: 12 },
                          ]}
                        >
                          DESCRIPTION
                        </Text>
                        <Text
                          style={[
                            styles.blockBody,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {selectedTestCase.description}
                        </Text>
                      </>
                    )}
                  </View>

                  {/* Numbered Test Steps */}
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.blockLabel, { color: colors.textMuted }]}
                    >
                      TEST STEPS ({(selectedTestCase.steps || []).length})
                    </Text>
                    {(selectedTestCase.steps || []).map((step, idx) => (
                      <View
                        key={step.id || idx}
                        style={[
                          styles.stepItem,
                          { borderBottomColor: colors.border },
                          idx === (selectedTestCase.steps || []).length - 1 && {
                            borderBottomWidth: 0,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.stepNumberCircle,
                            { backgroundColor: colors.primarySoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.stepNumberText,
                              { color: colors.primary },
                            ]}
                          >
                            {step.stepNumber || idx + 1}
                          </Text>
                        </View>
                        <View style={styles.stepContentCol}>
                          <Text
                            style={[
                              styles.stepActionText,
                              { color: colors.text },
                            ]}
                          >
                            {step.action}
                          </Text>
                          {!!step.testData && (
                            <Text
                              style={[
                                styles.stepExpectedText,
                                { color: colors.primary },
                              ]}
                            >
                              Test Data: {step.testData}
                            </Text>
                          )}
                          {!!step.expectedResult && (
                            <Text
                              style={[
                                styles.stepExpectedText,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Expected: {step.expectedResult}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Overall Expected Result */}
                  <View
                    style={[
                      styles.detailBlock,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.blockLabel, { color: colors.textMuted }]}
                    >
                      OVERALL EXPECTED RESULT
                    </Text>
                    <Text
                      style={[styles.blockBody, { color: colors.text }]}
                    >
                      {selectedTestCase.expectedResult}
                    </Text>
                  </View>
                </ScrollView>

                <View
                  style={[
                    styles.modalFooter,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      const target = selectedTestCase;
                      setSelectedTestCaseId(null);
                      setDeletingCase(target);
                    }}
                    style={[
                      styles.footerDangerBtn,
                      {
                        backgroundColor: colors.dangerSoft,
                        borderColor: colors.danger,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.footerDangerText, { color: colors.danger }]}
                    >
                      Delete
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const tc = selectedTestCase;
                      setSelectedTestCaseId(null);
                      openEditCaseModal(tc);
                    }}
                    style={[
                      styles.footerSecondaryBtn,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.footerSecondaryText,
                        { color: colors.text },
                      ]}
                    >
                      Edit Case
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSelectedTestCaseId(null)}
                    style={[
                      styles.footerPrimaryBtn,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text style={styles.footerPrimaryText}>Done</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ===================================================================
          MODAL 2: CREATE / EDIT TEST CASE
         =================================================================== */}
      <Modal
        visible={isFormModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !isSubmittingCase && setIsFormModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
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
              <Text
                accessibilityRole="header"
                style={[styles.modalTitle, { color: colors.text }]}
              >
                {editingCase
                  ? `Edit ${editingCase.testCaseId || editingCase.id}`
                  : 'Create New Test Case'}
              </Text>
              <Pressable
                onPress={() => !isSubmittingCase && setIsFormModalOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close test case form"
                style={[
                  styles.closeCircle,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <VectorIcon
                  name="close"
                  size={14}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={false}
            >
              {caseFormError && (
                <View
                  style={[
                    styles.formAlertBox,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text style={[styles.formAlertText, { color: colors.danger }]}>
                    {caseFormError}
                  </Text>
                </View>
              )}

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Test Case Title *
              </Text>
              <TextInput
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="e.g., Verify biometric login fallback to PIN"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Test Case Title, required"
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Test Suite *
              </Text>
              {suites.length === 0 ? (
                <Text
                  style={[styles.emptyHintText, { color: colors.textMuted }]}
                >
                  No suites exist yet — a default &quot;General QA Suite&quot;
                  will be created automatically.
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.optionChipsRow}
                >
                  {suites.map((s) => {
                    const active = formSuiteId === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setFormSuiteId(s.id)}
                        style={[
                          styles.optionChip,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.surfaceMuted,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            { color: active ? '#ffffff' : colors.textSecondary },
                          ]}
                        >
                          {s.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Priority
              </Text>
              <View style={styles.optionChipsWrap}>
                {priorities.map((p) => {
                  const active = formPriority === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setFormPriority(p)}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : colors.surfaceMuted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: active ? '#ffffff' : colors.textSecondary },
                        ]}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Category / Test Type
              </Text>
              <View style={styles.optionChipsWrap}>
                {testTypes.map((t) => {
                  const active = formTestType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setFormTestType(t)}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : colors.surfaceMuted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: active ? '#ffffff' : colors.textSecondary },
                        ]}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Tags (comma-separated)
              </Text>
              <TextInput
                value={formTags}
                onChangeText={setFormTags}
                placeholder="e.g., auth, smoke, release-gate"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Description / Objective
              </Text>
              <TextInput
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="Brief summary of what this test validates..."
                placeholderTextColor={colors.textMuted}
                multiline
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Preconditions
              </Text>
              <TextInput
                value={formPreconditions}
                onChangeText={setFormPreconditions}
                placeholder="Required user state, test data, or configuration..."
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              {/* Dynamic Steps Builder */}
              <View style={styles.stepsHeaderRow}>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
                  Execution Steps
                </Text>
                <Pressable onPress={addStepRow}>
                  <Text style={[styles.addStepLink, { color: colors.primary }]}>
                    + Add Step
                  </Text>
                </Pressable>
              </View>

              {formSteps.map((step, index) => (
                <View
                  key={`form-step-${index}`}
                  style={[
                    styles.stepBuilderCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.stepBuilderTop}>
                    <Text
                      style={[styles.stepBuilderTitle, { color: colors.primary }]}
                    >
                      Step #{index + 1}
                    </Text>
                    {formSteps.length > 1 && (
                      <Pressable onPress={() => removeStepRow(index)}>
                        <Text
                          style={{
                            color: colors.danger,
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          Remove
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    value={step.action}
                    onChangeText={(val) =>
                      handleStepChange(index, 'action', val)
                    }
                    placeholder="Action: What the tester does..."
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.surfaceMuted,
                        color: colors.text,
                        borderColor: colors.border,
                        marginBottom: 8,
                      },
                    ]}
                  />
                  <TextInput
                    value={step.testData}
                    onChangeText={(val) =>
                      handleStepChange(index, 'testData', val)
                    }
                    placeholder="Test Data (optional): e.g. user@qavora.io"
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.surfaceMuted,
                        color: colors.text,
                        borderColor: colors.border,
                        marginBottom: 8,
                      },
                    ]}
                  />
                  <TextInput
                    value={step.expectedResult}
                    onChangeText={(val) =>
                      handleStepChange(index, 'expectedResult', val)
                    }
                    placeholder="Expected step result..."
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.surfaceMuted,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>
              ))}

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Overall Expected Result
              </Text>
              <TextInput
                value={formExpectedResult}
                onChangeText={setFormExpectedResult}
                placeholder="Final outcome when all steps succeed..."
                placeholderTextColor={colors.textMuted}
                multiline
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />
            </ScrollView>

            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <Pressable
                disabled={isSubmittingCase}
                onPress={() => setIsFormModalOpen(false)}
                style={[
                  styles.footerSecondaryBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    opacity: isSubmittingCase ? 0.5 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.footerSecondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={isSubmittingCase}
                onPress={handleSaveTestCase}
                style={[
                  styles.footerPrimaryBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: isSubmittingCase ? 0.65 : 1,
                  },
                ]}
              >
                {isSubmittingCase ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.footerPrimaryText}>
                    {editingCase ? 'Save Changes' : 'Create Test Case'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================
          MODAL 3: MOVE TEST CASE BETWEEN SUITES
         =================================================================== */}
      <Modal
        visible={!!movingCase}
        animationType="fade"
        transparent
        onRequestClose={() => !isMovingCase && setMovingCase(null)}
      >
        <View style={styles.centeredModalOverlay}>
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {movingCase && (
              <>
                <Text
                  style={[
                    styles.smallModalTitle,
                    { color: colors.text },
                  ]}
                >
                  Move {movingCase.testCaseId || movingCase.id} to Suite
                </Text>
                <Text
                  style={[
                    styles.confirmDialogDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Current Suite: &quot;{movingCase.suiteName}&quot;. Select a
                  destination suite below:
                </Text>

                <View style={styles.suiteSelectList}>
                  {suites.map((s) => {
                    const active = moveTargetSuiteId === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setMoveTargetSuiteId(s.id)}
                        style={[
                          styles.suiteSelectItem,
                          {
                            backgroundColor: active
                              ? colors.primarySoft
                              : colors.surfaceMuted,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name={active ? 'check' : 'folder'}
                          size={14}
                          color={active ? colors.primary : colors.textSecondary}
                        />
                        <Text
                          style={[
                            styles.suiteSelectItemText,
                            {
                              color: active
                                ? colors.primary
                                : colors.text,
                            },
                          ]}
                        >
                          {s.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.smallModalActions}>
                  <Pressable
                    disabled={isMovingCase}
                    onPress={() => setMovingCase(null)}
                    style={[
                      styles.footerSecondaryBtn,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.footerSecondaryText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={isMovingCase}
                    onPress={handleConfirmMoveCase}
                    style={[
                      styles.footerPrimaryBtn,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    {isMovingCase ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.footerPrimaryText}>Move Case</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ===================================================================
          MODAL 4: DELETE TEST CASE CONFIRMATION
         =================================================================== */}
      <Modal
        visible={!!deletingCase}
        animationType="fade"
        transparent
        onRequestClose={() => !isDeletingCase && setDeletingCase(null)}
      >
        <View style={styles.centeredModalOverlay}>
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {deletingCase && (
              <>
                <Text
                  style={[
                    styles.smallModalTitle,
                    { color: colors.text },
                  ]}
                >
                  Delete Test Case?
                </Text>
                <Text
                  style={[
                    styles.confirmDialogDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Are you sure you want to permanently delete{' '}
                  <Text style={{ fontWeight: '800', color: colors.text }}>
                    {deletingCase.testCaseId || deletingCase.id}: &quot;
                    {deletingCase.title}&quot;
                  </Text>{' '}
                  from suite &quot;{deletingCase.suiteName}&quot;?
                </Text>

                <View style={styles.smallModalActions}>
                  <Pressable
                    disabled={isDeletingCase}
                    onPress={() => setDeletingCase(null)}
                    style={[
                      styles.footerSecondaryBtn,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.footerSecondaryText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={isDeletingCase}
                    onPress={handleConfirmDeleteCase}
                    style={[
                      styles.footerPrimaryBtn,
                      { backgroundColor: colors.danger },
                    ]}
                  >
                    {isDeletingCase ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.footerPrimaryText}>
                        Confirm Delete
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ===================================================================
          MODAL 5: CREATE / EDIT TEST SUITE
         =================================================================== */}
      <Modal
        visible={isSuiteModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => !isSubmittingSuite && setIsSuiteModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centeredModalOverlay}
        >
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[styles.smallModalTitle, { color: colors.text }]}
            >
              {editingSuite ? 'Edit Test Suite' : 'Create Test Suite'}
            </Text>

            {suiteFormError && (
              <View
                style={[
                  styles.formAlertBox,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.formAlertText, { color: colors.danger }]}>
                  {suiteFormError}
                </Text>
              </View>
            )}

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Suite Name *
            </Text>
            <TextInput
              value={suiteNameInput}
              onChangeText={setSuiteNameInput}
              placeholder="e.g., Payment & Checkout Flows"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Category
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.optionChipsRow}
            >
              {(suiteCategories || ['Functional', 'UI/UX', 'Security', 'Regression']).map(
                (cat) => {
                  const active = suiteCategoryInput === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setSuiteCategoryInput(cat)}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : colors.surfaceMuted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: active ? '#ffffff' : colors.textSecondary },
                        ]}
                      >
                        {cat}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </ScrollView>

            {planPhases.length > 0 && (
              <>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
                  Testing Phase
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.optionChipsRow}
                >
                  <Pressable
                    onPress={() => setSuitePhaseIdInput('')}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: !suitePhaseIdInput
                          ? colors.primary
                          : colors.surfaceMuted,
                        borderColor: !suitePhaseIdInput
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        {
                          color: !suitePhaseIdInput
                            ? '#ffffff'
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      General (Unassigned)
                    </Text>
                  </Pressable>
                  {planPhases.map((ph) => {
                    const active = suitePhaseIdInput === ph.id;
                    return (
                      <Pressable
                        key={ph.id}
                        onPress={() => setSuitePhaseIdInput(ph.id)}
                        style={[
                          styles.optionChip,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.surfaceMuted,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            { color: active ? '#ffffff' : colors.textSecondary },
                          ]}
                        >
                          {ph.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Tags (comma-separated)
            </Text>
            <TextInput
              value={suiteTagsInput}
              onChangeText={setSuiteTagsInput}
              placeholder="e.g., checkout, stripe, critical"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Description
            </Text>
            <TextInput
              value={suiteDescInput}
              onChangeText={setSuiteDescInput}
              placeholder="Scope of this test suite..."
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <View style={styles.smallModalActions}>
              <Pressable
                disabled={isSubmittingSuite}
                onPress={() => setIsSuiteModalOpen(false)}
                style={[
                  styles.footerSecondaryBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.footerSecondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={isSubmittingSuite}
                onPress={handleSaveSuite}
                style={[
                  styles.footerPrimaryBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isSubmittingSuite ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.footerPrimaryText}>
                    {editingSuite ? 'Save Suite' : 'Create Suite'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================
          MODAL 6: DELETE TEST SUITE CONFIRMATION (WITH CASE PRESERVATION)
         =================================================================== */}
      <Modal
        visible={!!deletingSuite}
        animationType="fade"
        transparent
        onRequestClose={() => !isDeletingSuite && setDeletingSuite(null)}
      >
        <View style={styles.centeredModalOverlay}>
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {deletingSuite && (
              <>
                <Text
                  style={[
                    styles.smallModalTitle,
                    { color: colors.text },
                  ]}
                >
                  Delete Suite &quot;{deletingSuite.name}&quot;?
                </Text>

                {(() => {
                  const caseCount = suiteStatsMap[deletingSuite.id]?.total || 0;
                  const otherSuites = suites.filter(
                    (s) => s.id !== deletingSuite.id
                  );

                  if (caseCount === 0) {
                    return (
                      <Text
                        style={[
                          styles.confirmDialogDesc,
                          { color: colors.textSecondary },
                        ]}
                      >
                        This test suite contains 0 test cases. Are you sure you
                        want to delete it?
                      </Text>
                    );
                  }

                  return (
                    <View style={{ gap: 10 }}>
                      <Text
                        style={[
                          styles.confirmDialogDesc,
                          { color: colors.textSecondary },
                        ]}
                      >
                        This suite contains{' '}
                        <Text
                          style={{
                            fontWeight: '800',
                            color: colors.text,
                          }}
                        >
                          {caseCount} test {caseCount === 1 ? 'case' : 'cases'}
                        </Text>
                        . Choose how to handle existing test cases:
                      </Text>

                      {otherSuites.length > 0 && (
                        <Pressable
                          onPress={() => setSuiteDeleteMode('move')}
                          style={[
                            styles.suiteSelectItem,
                            {
                              backgroundColor:
                                suiteDeleteMode === 'move'
                                  ? colors.primarySoft
                                  : colors.surfaceMuted,
                              borderColor:
                                suiteDeleteMode === 'move'
                                  ? colors.primary
                                  : colors.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name={
                              suiteDeleteMode === 'move' ? 'check' : 'switch'
                            }
                            size={14}
                            color={
                              suiteDeleteMode === 'move'
                                ? colors.primary
                                : colors.textSecondary
                            }
                          />
                          <Text
                            style={[
                              styles.suiteSelectItemText,
                              {
                                color:
                                  suiteDeleteMode === 'move'
                                    ? colors.primary
                                    : colors.text,
                              },
                            ]}
                          >
                            Move {caseCount} case(s) to another suite
                          </Text>
                        </Pressable>
                      )}

                      {suiteDeleteMode === 'move' && otherSuites.length > 0 && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.optionChipsRow}
                        >
                          {otherSuites.map((s) => {
                            const active = suiteDeleteTargetId === s.id;
                            return (
                              <Pressable
                                key={s.id}
                                onPress={() => setSuiteDeleteTargetId(s.id)}
                                style={[
                                  styles.optionChip,
                                  {
                                    backgroundColor: active
                                      ? colors.primary
                                      : colors.surfaceMuted,
                                    borderColor: active
                                      ? colors.primary
                                      : colors.border,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.optionChipText,
                                    {
                                      color: active
                                        ? '#ffffff'
                                        : colors.textSecondary,
                                    },
                                  ]}
                                >
                                  {s.name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      )}

                      <Pressable
                        onPress={() => setSuiteDeleteMode('delete')}
                        style={[
                          styles.suiteSelectItem,
                          {
                            backgroundColor:
                              suiteDeleteMode === 'delete'
                                ? colors.dangerSoft
                                : colors.surfaceMuted,
                            borderColor:
                              suiteDeleteMode === 'delete'
                                ? colors.danger
                                : colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="trash"
                          size={14}
                          color={
                            suiteDeleteMode === 'delete'
                              ? colors.danger
                              : colors.textSecondary
                          }
                        />
                        <Text
                          style={[
                            styles.suiteSelectItemText,
                            {
                              color:
                                suiteDeleteMode === 'delete'
                                  ? colors.danger
                                  : colors.text,
                            },
                          ]}
                        >
                          Delete suite and its {caseCount} test case(s)
                        </Text>
                      </Pressable>
                    </View>
                  );
                })()}

                <View style={styles.smallModalActions}>
                  <Pressable
                    disabled={isDeletingSuite}
                    onPress={() => setDeletingSuite(null)}
                    style={[
                      styles.footerSecondaryBtn,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.footerSecondaryText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={isDeletingSuite}
                    onPress={handleConfirmDeleteSuite}
                    style={[
                      styles.footerPrimaryBtn,
                      { backgroundColor: colors.danger },
                    ]}
                  >
                    {isDeletingSuite ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.footerPrimaryText}>Delete Suite</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ===================================================================
          MODAL 7: EDIT TEST PLAN
         =================================================================== */}
      <Modal
        visible={isPlanModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !isSubmittingPlan && setIsPlanModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
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
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Edit Project Test Plan
              </Text>
              <Pressable
                onPress={() => !isSubmittingPlan && setIsPlanModalOpen(false)}
                style={[
                  styles.closeCircle,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <VectorIcon
                  name="close"
                  size={14}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={false}
            >
              {planFormError && (
                <View
                  style={[
                    styles.formAlertBox,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text style={[styles.formAlertText, { color: colors.danger }]}>
                    {planFormError}
                  </Text>
                </View>
              )}

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Test Plan Name *
              </Text>
              <TextInput
                value={planForm.name}
                onChangeText={(val) => handlePlanFieldChange('name', val)}
                placeholder="e.g., Qavora v2.4 Master Test Plan"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
              />

              {[
                {
                  key: 'description',
                  label: 'Plan Overview & Description',
                  placeholder: 'High-level summary of the release test plan...',
                },
                {
                  key: 'objective',
                  label: 'Testing Objectives',
                  placeholder: 'Primary quality goals and validation targets...',
                },
                {
                  key: 'scope',
                  label: 'In Scope',
                  placeholder: 'Features, modules, and APIs covered by this plan...',
                },
                {
                  key: 'outOfScope',
                  label: 'Out of Scope',
                  placeholder: 'Features explicitly excluded from this cycle...',
                },
                {
                  key: 'strategy',
                  label: 'Test Strategy & Approach',
                  placeholder: 'Manual, automated, exploratory, regression strategy...',
                },
                {
                  key: 'environment',
                  label: 'Test Environment & Infrastructure',
                  placeholder: 'Target devices, OS versions, staging endpoints...',
                },
                {
                  key: 'entryCriteria',
                  label: 'Entry Criteria',
                  placeholder: 'Conditions required before testing starts...',
                },
                {
                  key: 'exitCriteria',
                  label: 'Exit Criteria',
                  placeholder: 'Pass rate and defect thresholds for sign-off...',
                },
                {
                  key: 'deliverables',
                  label: 'QA Deliverables',
                  placeholder: 'Test reports, defect logs, release sign-off...',
                },
                {
                  key: 'risks',
                  label: 'Risks & Mitigation',
                  placeholder: 'Known technical or schedule risks and fallbacks...',
                },
                {
                  key: 'tools',
                  label: 'Tools & Automation Stack',
                  placeholder: 'Qavora, Playwright, Postman, Android Studio...',
                },
                {
                  key: 'schedule',
                  label: 'Schedule & Milestones',
                  placeholder: 'Target dates for freeze, regression, and release...',
                },
                {
                  key: 'approvals',
                  label: 'Sign-off & Approvals',
                  placeholder: 'QA Lead, Product Manager, Engineering Lead...',
                },
                {
                  key: 'notes',
                  label: 'Additional Notes',
                  placeholder: 'Any supplemental test plan notes...',
                },
              ].map((field) => (
                <View key={field.key}>
                  <Text
                    style={[styles.inputLabel, { color: colors.textSecondary }]}
                  >
                    {field.label}
                  </Text>
                  <TextInput
                    value={planForm[field.key]}
                    onChangeText={(val) =>
                      handlePlanFieldChange(field.key, val)
                    }
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.textMuted}
                    multiline
                    style={[
                      styles.textArea,
                      {
                        backgroundColor: colors.surfaceMuted,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>
              ))}
            </ScrollView>

            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <Pressable
                disabled={isSubmittingPlan}
                onPress={() => setIsPlanModalOpen(false)}
                style={[
                  styles.footerSecondaryBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.footerSecondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={isSubmittingPlan}
                onPress={handleSavePlan}
                style={[
                  styles.footerPrimaryBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isSubmittingPlan ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.footerPrimaryText}>Save Test Plan</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================
          MODAL 8: CREATE / EDIT TESTING PHASE
         =================================================================== */}
      <Modal
        visible={isPhaseModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => !isSubmittingPhase && setIsPhaseModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centeredModalOverlay}
        >
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[styles.smallModalTitle, { color: colors.text }]}
            >
              {editingPhase ? 'Edit Testing Phase' : 'Add Testing Phase'}
            </Text>

            {phaseFormError && (
              <View
                style={[
                  styles.formAlertBox,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.formAlertText, { color: colors.danger }]}>
                  {phaseFormError}
                </Text>
              </View>
            )}

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Phase Name *
            </Text>
            <TextInput
              value={phaseNameInput}
              onChangeText={setPhaseNameInput}
              placeholder="e.g., Phase 1: Smoke & Sanity"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Phase Description
            </Text>
            <TextInput
              value={phaseDescInput}
              onChangeText={setPhaseDescInput}
              placeholder="Goals and gate criteria for this phase..."
              placeholderTextColor={colors.textMuted}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <View style={styles.smallModalActions}>
              <Pressable
                disabled={isSubmittingPhase}
                onPress={() => setIsPhaseModalOpen(false)}
                style={[
                  styles.footerSecondaryBtn,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.footerSecondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={isSubmittingPhase}
                onPress={handleSavePhase}
                style={[
                  styles.footerPrimaryBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isSubmittingPhase ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.footerPrimaryText}>
                    {editingPhase ? 'Save Phase' : 'Add Phase'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================
          MODAL 9: DELETE TESTING PHASE CONFIRMATION
         =================================================================== */}
      <Modal
        visible={!!deletingPhase}
        animationType="fade"
        transparent
        onRequestClose={() => !isDeletingPhase && setDeletingPhase(null)}
      >
        <View style={styles.centeredModalOverlay}>
          <View
            style={[
              styles.smallModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {deletingPhase && (
              <>
                <Text
                  style={[
                    styles.smallModalTitle,
                    { color: colors.text },
                  ]}
                >
                  Delete Phase &quot;{deletingPhase.name}&quot;?
                </Text>
                <Text
                  style={[
                    styles.confirmDialogDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Deleting this testing phase will remove the phase milestone
                  from the Test Plan while preserving all existing test suites
                  and test cases in the project.
                </Text>

                <View style={styles.smallModalActions}>
                  <Pressable
                    disabled={isDeletingPhase}
                    onPress={() => setDeletingPhase(null)}
                    style={[
                      styles.footerSecondaryBtn,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.footerSecondaryText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={isDeletingPhase}
                    onPress={handleConfirmDeletePhase}
                    style={[
                      styles.footerPrimaryBtn,
                      { backgroundColor: colors.danger },
                    ]}
                  >
                    {isDeletingPhase ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.footerPrimaryText}>Delete Phase</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
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
  topSubNavWrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  projectContextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    rowGap: 4,
  },
  projectContextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexShrink: 1,
    minWidth: 140,
  },
  projectContextName: {
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  syncStatusRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  syncPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  segmentedBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  segmentBtnText: {
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  errorBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  errorBannerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  errorBannerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  errorBannerBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  errorBannerBtnOutline: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorBannerBtnOutlineText: {
    fontSize: 11,
    fontWeight: '700',
  },
  topSearchWrap: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchBarRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    gap: 8,
  },
  searchInputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  addCaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 40,
  },
  addCaseBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  suiteScrollContent: {
    paddingHorizontal: 14,
    gap: 6,
  },
  suiteChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  suiteChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterRowContent: {
    paddingHorizontal: 14,
    gap: 6,
    alignItems: 'center',
  },
  miniFilterChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  miniFilterText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterDivider: {
    width: 1,
    height: 16,
    marginHorizontal: 4,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    padding: 14,
    paddingBottom: 32,
    gap: 10,
  },
  resultsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  resetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyCta: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyCtaText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  caseCard: {
    borderRadius: 13,
    borderWidth: 1,
    padding: 13,
    gap: 7,
  },
  caseTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  caseIdBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  caseId: {
    fontSize: 12,
    fontWeight: '700',
  },
  prioBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  prioBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  caseTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  caseDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  caseFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  caseMetaRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  stepsCountText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
  },
  cardMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  cardMiniBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionBannerCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  sectionBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  sectionBannerSub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  secondaryActionBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  suiteDetailCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  suiteDetailTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  suiteBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  suiteDetailName: {
    fontSize: 15,
    fontWeight: '800',
  },
  suiteDetailDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  suiteTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  caseCountBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 54,
  },
  caseCountNumber: {
    fontSize: 15,
    fontWeight: '800',
  },
  caseCountLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  suiteStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    flexWrap: 'wrap',
    gap: 6,
  },
  suiteStatItem: {
    fontSize: 11,
    fontWeight: '700',
  },
  planHeaderCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  planHeaderTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  planIdLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  planSummaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    justifyContent: 'space-around',
    gap: 8,
  },
  planMetricBox: {
    alignItems: 'center',
    minWidth: 60,
    gap: 2,
  },
  planMetricVal: {
    fontSize: 15,
    fontWeight: '800',
  },
  planMetricLbl: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  planSectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  planSectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  planSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  planSectionSub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  inlineEmptyBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
  },
  inlineEmptyText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  phaseRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  phaseOrderCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseOrderText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  phaseRowName: {
    fontSize: 13,
    fontWeight: '800',
  },
  phaseRowDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  phaseRowStats: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  phaseRowActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconSquareBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planDocBlock: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 11,
    gap: 4,
  },
  planDocLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planDocValue: {
    fontSize: 13,
    lineHeight: 19,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  modalIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  modalCaseId: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalSuiteName: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    maxHeight: 500,
  },
  modalBodyContent: {
    padding: 16,
    gap: 12,
  },
  detailBlock: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  blockLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  blockBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  quickStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickStatusBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  metaCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 3,
  },
  metaCellLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metaCellValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  stepItem: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  stepNumberCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '800',
  },
  stepContentCol: {
    flex: 1,
    gap: 3,
  },
  stepActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepExpectedText: {
    fontSize: 12,
    lineHeight: 17,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 14,
    borderTopWidth: 1,
    gap: 8,
  },
  footerDangerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerDangerText: {
    fontSize: 13,
    fontWeight: '700',
  },
  footerSecondaryBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  footerPrimaryBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  formAlertBox: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  formAlertText: {
    fontSize: 12,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyHintText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  optionChipsRow: {
    gap: 6,
    paddingVertical: 2,
  },
  optionChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
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
  stepsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  addStepLink: {
    fontSize: 12,
    fontWeight: '800',
  },
  stepBuilderCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  stepBuilderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepBuilderTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  centeredModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  smallModalCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  smallModalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  confirmDialogDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  suiteSelectList: {
    gap: 8,
    marginVertical: 4,
  },
  suiteSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  suiteSelectItemText: {
    fontSize: 13,
    fontWeight: '700',
  },
  smallModalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
});

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Text,
  View,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import {
  useWorkspace,
  useWorkspaceBackOverlay,
} from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import styles from './testCases/testCasesStyles';
import TestCaseDetailModal from './testCases/TestCaseDetailModal';
import TestCaseFormModal from './testCases/TestCaseFormModal';
import TestCaseMoveModal from './testCases/TestCaseMoveModal';
import TestCaseDeleteModal from './testCases/TestCaseDeleteModal';
import TestSuiteFormModal from './testCases/TestSuiteFormModal';
import TestSuiteDeleteModal from './testCases/TestSuiteDeleteModal';
import TestPlanFormModal from './testCases/TestPlanFormModal';
import TestPhaseFormModal from './testCases/TestPhaseFormModal';
import TestPhaseDeleteModal from './testCases/TestPhaseDeleteModal';

const SuiteChipItem = React.memo(function SuiteChipItem({
  suite,
  count,
  active,
  colors,
  onSelectSuite,
}) {
  return (
    <Pressable
      onPress={() => onSelectSuite(suite.id)}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter by suite: ${suite.name} (${count} cases)`}
      style={[
        styles.suiteChip,
        {
          backgroundColor: active ? colors.primary : colors.surfaceMuted,
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
});

const TestCaseRowCard = React.memo(function TestCaseRowCard({
  tc,
  prioStyle,
  statusStyle,
  colors,
  canMoveSuite,
  onOpenCase,
  onMoveCase,
  onEditCase,
  onDeleteCase,
}) {
  const displayId = tc.testCaseId || tc.id;

  return (
    <Pressable
      onPress={() => onOpenCase(tc.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open test case ${displayId}: ${tc.title}, ${tc.priority} priority, status ${tc.lastStatus}`}
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
            {displayId}
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
            <Text style={[styles.prioBadgeText, { color: prioStyle.text }]}>
              {tc.priority}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.statusBadgeText, { color: statusStyle.text }]}>
            {tc.lastStatus}
          </Text>
        </View>
      </View>

      <Text style={[styles.caseTitle, { color: colors.text }]}>{tc.title}</Text>

      {!!tc.description && (
        <Text
          style={[styles.caseDesc, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {tc.description}
        </Text>
      )}

      <View style={styles.caseFooterRow}>
        <View style={styles.caseMetaRow}>
          <View
            style={[styles.metaPill, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text
              style={[styles.metaPillText, { color: colors.textSecondary }]}
            >
              {tc.suiteName}
            </Text>
          </View>
          <View
            style={[styles.metaPill, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text style={[styles.metaPillText, { color: colors.textMuted }]}>
              {tc.testType || tc.category}
            </Text>
          </View>
        </View>
        <Text style={[styles.stepsCountText, { color: colors.textMuted }]}>
          {(tc.steps || []).length} steps
        </Text>
      </View>

      {/* Quick Card Actions: Move Suite | Edit | Delete */}
      <View style={[styles.cardActionsBar, { borderTopColor: colors.border }]}>
        {canMoveSuite && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onMoveCase(tc);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Move ${displayId} to another suite`}
            style={[
              styles.cardMiniBtn,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
          >
            <VectorIcon name="switch" size={12} color={colors.textSecondary} />
            <Text
              style={[styles.cardMiniBtnText, { color: colors.textSecondary }]}
            >
              Move Suite
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onEditCase(tc);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${displayId}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <VectorIcon name="edit" size={12} color={colors.primary} />
          <Text style={[styles.cardMiniBtnText, { color: colors.primary }]}>
            Edit
          </Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onDeleteCase(tc);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${displayId}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.dangerSoft,
              borderColor: colors.danger,
            },
          ]}
        >
          <VectorIcon name="trash" size={12} color={colors.danger} />
          <Text style={[styles.cardMiniBtnText, { color: colors.danger }]}>
            Delete
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

const TestSuiteRowCard = React.memo(function TestSuiteRowCard({
  suite,
  stats,
  linkedPhase,
  colors,
  onViewSuiteCases,
  onAddCaseToSuite,
  onEditSuite,
  onDeleteSuite,
}) {
  return (
    <View
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
              style={[styles.metaPill, { backgroundColor: colors.primarySoft }]}
            >
              <Text style={[styles.metaPillText, { color: colors.primary }]}>
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
                  style={[styles.metaPillText, { color: colors.textSecondary }]}
                >
                  Phase: {linkedPhase.name}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.suiteDetailName, { color: colors.text }]}>
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
          <Text style={[styles.caseCountNumber, { color: colors.primary }]}>
            {stats.total}
          </Text>
          <Text style={[styles.caseCountLabel, { color: colors.textMuted }]}>
            {stats.total === 1 ? 'Case' : 'Cases'}
          </Text>
        </View>
      </View>

      <Text style={[styles.suiteDetailDesc, { color: colors.textSecondary }]}>
        {suite.description || 'No suite description provided.'}
      </Text>

      {Array.isArray(suite.tags) && suite.tags.length > 0 && (
        <View style={styles.suiteTagsRow}>
          {suite.tags.map((tag, idx) => (
            <View
              key={`${suite.id}-tag-${idx}`}
              style={[styles.metaPill, { backgroundColor: colors.surfaceMuted }]}
            >
              <Text style={[styles.metaPillText, { color: colors.textMuted }]}>
                #{tag}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Suite Status Breakdown */}
      <View
        style={[styles.suiteStatsRow, { backgroundColor: colors.surfaceMuted }]}
      >
        <Text style={[styles.suiteStatItem, { color: colors.success }]}>
          Passed: {stats.passed}
        </Text>
        <Text style={[styles.suiteStatItem, { color: colors.danger }]}>
          Failed: {stats.failed}
        </Text>
        <Text style={[styles.suiteStatItem, { color: colors.warning }]}>
          Blocked: {stats.blocked}
        </Text>
        <Text style={[styles.suiteStatItem, { color: colors.textMuted }]}>
          Untested: {stats.untested}
        </Text>
      </View>

      <View style={[styles.cardActionsBar, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => onViewSuiteCases(suite.id)}
          accessibilityRole="button"
          accessibilityLabel={`View ${stats.total} cases in suite ${suite.name}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
          ]}
        >
          <VectorIcon name="layers" size={12} color={colors.primary} />
          <Text style={[styles.cardMiniBtnText, { color: colors.primary }]}>
            View Cases ({stats.total})
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onAddCaseToSuite(suite.id)}
          accessibilityRole="button"
          accessibilityLabel={`Add case to suite ${suite.name}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <VectorIcon name="plus" size={12} color={colors.text} />
          <Text style={[styles.cardMiniBtnText, { color: colors.text }]}>
            Add Case
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onEditSuite(suite)}
          accessibilityRole="button"
          accessibilityLabel={`Edit suite ${suite.name}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <VectorIcon name="edit" size={12} color={colors.textSecondary} />
          <Text
            style={[styles.cardMiniBtnText, { color: colors.textSecondary }]}
          >
            Edit
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onDeleteSuite(suite)}
          accessibilityRole="button"
          accessibilityLabel={`Delete suite ${suite.name}`}
          style={[
            styles.cardMiniBtn,
            {
              backgroundColor: colors.dangerSoft,
              borderColor: colors.danger,
            },
          ]}
        >
          <VectorIcon name="trash" size={12} color={colors.danger} />
          <Text style={[styles.cardMiniBtnText, { color: colors.danger }]}>
            Delete
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const TestPhaseRowCard = React.memo(function TestPhaseRowCard({
  phase,
  orderNumber,
  suiteCount,
  caseCount,
  colors,
  onEditPhase,
  onDeletePhase,
}) {
  return (
    <View
      style={[
        styles.phaseRowCard,
        {
          backgroundColor: colors.surface,
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
        <Text style={styles.phaseOrderText}>{orderNumber}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.phaseRowName, { color: colors.text }]}>
          {phase.name}
        </Text>
        <Text style={[styles.phaseRowDesc, { color: colors.textSecondary }]}>
          {phase.description || 'No phase description'}
        </Text>
        <Text style={[styles.phaseRowStats, { color: colors.textMuted }]}>
          {suiteCount} suites · {caseCount} cases
        </Text>
      </View>
      <View style={styles.phaseRowActions}>
        <Pressable
          onPress={() => onEditPhase(phase)}
          hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit testing phase ${phase.name}`}
          style={[
            styles.iconSquareBtn,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <VectorIcon name="edit" size={13} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => onDeletePhase(phase)}
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
          <VectorIcon name="trash" size={13} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
});

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
    notifyBlockedSwipeTouchStart,
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

  const setSubTab = useCallback(
    (nextTab) => {
      const cleanTab =
        nextTab === 'suites' || nextTab === 'plan' ? nextTab : 'cases';
      setLocalSubTab(cleanTab);
      if (typeof onChangeSubTab === 'function') {
        onChangeSubTab(cleanTab);
      }
      if (typeof setContextSubTab === 'function') {
        setContextSubTab(cleanTab);
      }
    },
    [onChangeSubTab, setContextSubTab]
  );

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

  useWorkspaceBackOverlay(() => {
    if (deletingCase) {
      if (!isDeletingCase) setDeletingCase(null);
      return true;
    }
    if (movingCase) {
      if (!isMovingCase) setMovingCase(null);
      return true;
    }
    if (isFormModalOpen) {
      if (!isSubmittingCase) setIsFormModalOpen(false);
      return true;
    }
    if (deletingSuite) {
      if (!isDeletingSuite) setDeletingSuite(null);
      return true;
    }
    if (isSuiteModalOpen) {
      if (!isSubmittingSuite) setIsSuiteModalOpen(false);
      return true;
    }
    if (deletingPhase) {
      if (!isDeletingPhase) setDeletingPhase(null);
      return true;
    }
    if (isPhaseModalOpen) {
      if (!isSubmittingPhase) setIsPhaseModalOpen(false);
      return true;
    }
    if (isPlanModalOpen) {
      if (!isSubmittingPlan) setIsPlanModalOpen(false);
      return true;
    }
    return false;
  });

  // Refs for form keyboard UX & auto-scroll
  const caseFormScrollRef = useRef(null);
  const caseTitleRef = useRef(null);
  const caseTagsRef = useRef(null);
  const caseDescRef = useRef(null);
  const casePreconditionsRef = useRef(null);
  const caseExpectedResultRef = useRef(null);

  const suiteFormScrollRef = useRef(null);
  const suiteNameRef = useRef(null);
  const suiteTagsRef = useRef(null);
  const suiteDescRef = useRef(null);

  const planFormScrollRef = useRef(null);

  const phaseNameRef = useRef(null);
  const phaseDescRef = useRef(null);

  const scrollModalTo = useCallback((scrollRef, yOffset) => {
    setTimeout(() => {
      if (
        scrollRef.current &&
        typeof scrollRef.current.scrollTo === 'function'
      ) {
        scrollRef.current.scrollTo({
          y: Math.max(0, yOffset),
          animated: true,
        });
      }
    }, 120);
  }, []);

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

  const getPriorityBadgeStyle = useCallback(
    (priority) => {
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
    },
    [colors]
  );

  const getStatusBadgeStyle = useCallback(
    (status) => {
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
    },
    [colors]
  );

  // =========================================================================
  // TEST CASE MODAL HANDLERS
  // =========================================================================

  const openCreateCaseModal = useCallback(
    (defaultSuiteId = null) => {
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
    },
    [selectedSuiteId, suites]
  );

  const openEditCaseModal = useCallback(
    (tc) => {
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
    },
    [suites]
  );

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

    Keyboard.dismiss();
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

  const openMoveCaseModal = useCallback(
    (tc) => {
      const otherSuite = suites.find((s) => s.id !== tc.suiteId) || suites[0];
      setMovingCase(tc);
      setMoveTargetSuiteId(otherSuite ? otherSuite.id : tc.suiteId);
    },
    [suites]
  );

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

  const openCreateSuiteModal = useCallback(() => {
    setEditingSuite(null);
    setSuiteNameInput('');
    setSuiteDescInput('');
    setSuiteCategoryInput('Functional');
    setSuitePhaseIdInput(planPhases[0]?.id || '');
    setSuiteTagsInput('');
    setSuiteFormError(null);
    setIsSuiteModalOpen(true);
  }, [planPhases]);

  const openEditSuiteModal = useCallback((suite) => {
    setEditingSuite(suite);
    setSuiteNameInput(suite.name || '');
    setSuiteDescInput(suite.description || '');
    setSuiteCategoryInput(suite.category || 'Functional');
    setSuitePhaseIdInput(suite.phaseId || '');
    setSuiteTagsInput(Array.isArray(suite.tags) ? suite.tags.join(', ') : '');
    setSuiteFormError(null);
    setIsSuiteModalOpen(true);
  }, []);

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

    Keyboard.dismiss();
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

  const openDeleteSuiteConfirm = useCallback(
    (suite) => {
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
    },
    [suites, suiteStatsMap]
  );

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

    Keyboard.dismiss();
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
    Keyboard.dismiss();
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

  const phaseById = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < planPhases.length; i += 1) {
      const p = planPhases[i];
      if (p?.id) map.set(p.id, p);
    }
    return map;
  }, [planPhases]);

  const phaseMetricsById = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < suites.length; i += 1) {
      const s = suites[i];
      if (!s?.phaseId) continue;
      const existing = map.get(s.phaseId) || { suiteCount: 0, caseCount: 0 };
      existing.suiteCount += 1;
      existing.caseCount += suiteStatsMap[s.id]?.total || 0;
      map.set(s.phaseId, existing);
    }
    return map;
  }, [suites, suiteStatsMap]);

  const handleViewSuiteCases = useCallback(
    (suiteId) => {
      setSelectedSuiteId(suiteId);
      setSubTab('cases');
    },
    [setSubTab]
  );

  const suiteChipKeyExtractor = useCallback(
    (item, index) => String(item?.id || `suite_chip_${index}`),
    []
  );

  const renderSuiteChipItem = useCallback(
    ({ item: suite }) => (
      <SuiteChipItem
        suite={suite}
        count={suiteStatsMap[suite.id]?.total || 0}
        active={selectedSuiteId === suite.id}
        colors={colors}
        onSelectSuite={setSelectedSuiteId}
      />
    ),
    [suiteStatsMap, selectedSuiteId, colors]
  );

  const caseKeyExtractor = useCallback(
    (item, index) => String(item?.id || item?.testCaseId || `case_${index}`),
    []
  );

  const renderTestCaseItem = useCallback(
    ({ item: tc }) => (
      <TestCaseRowCard
        tc={tc}
        prioStyle={getPriorityBadgeStyle(tc.priority)}
        statusStyle={getStatusBadgeStyle(tc.lastStatus)}
        colors={colors}
        canMoveSuite={suites.length > 1}
        onOpenCase={setSelectedTestCaseId}
        onMoveCase={openMoveCaseModal}
        onEditCase={openEditCaseModal}
        onDeleteCase={setDeletingCase}
      />
    ),
    [
      getPriorityBadgeStyle,
      getStatusBadgeStyle,
      colors,
      suites.length,
      setSelectedTestCaseId,
      openMoveCaseModal,
      openEditCaseModal,
    ]
  );

  const suiteDetailKeyExtractor = useCallback(
    (item, index) => String(item?.id || `suite_${index}`),
    []
  );

  const renderSuiteDetailItem = useCallback(
    ({ item: suite }) => {
      const stats = suiteStatsMap[suite.id] || {
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        untested: 0,
      };
      return (
        <TestSuiteRowCard
          suite={suite}
          stats={stats}
          linkedPhase={suite.phaseId ? phaseById.get(suite.phaseId) : null}
          colors={colors}
          onViewSuiteCases={handleViewSuiteCases}
          onAddCaseToSuite={openCreateCaseModal}
          onEditSuite={openEditSuiteModal}
          onDeleteSuite={openDeleteSuiteConfirm}
        />
      );
    },
    [
      suiteStatsMap,
      phaseById,
      colors,
      handleViewSuiteCases,
      openCreateCaseModal,
      openEditSuiteModal,
      openDeleteSuiteConfirm,
    ]
  );

  const phaseKeyExtractor = useCallback(
    (item, index) => String(item?.id || `phase_${index}`),
    []
  );

  const renderPhaseItem = useCallback(
    ({ item: phase, index }) => {
      const metrics = phaseMetricsById.get(phase.id) || {
        suiteCount: 0,
        caseCount: 0,
      };
      return (
        <TestPhaseRowCard
          phase={phase}
          orderNumber={index + 1}
          suiteCount={metrics.suiteCount}
          caseCount={metrics.caseCount}
          colors={colors}
          onEditPhase={openEditPhaseModal}
          onDeletePhase={setDeletingPhase}
        />
      );
    },
    [phaseMetricsById, colors]
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
                accessibilityRole="button"
                accessibilityLabel="Sync project test cases"
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
                accessibilityRole="button"
                accessibilityLabel="Reload latest test cases from server"
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
                accessibilityRole="button"
                accessibilityLabel="Dismiss project data error"
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
                  returnKeyType="search"
                  onSubmitEditing={() => Keyboard.dismiss()}
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
            <FlatList
              horizontal
              data={suites}
              keyExtractor={suiteChipKeyExtractor}
              renderItem={renderSuiteChipItem}
              showsHorizontalScrollIndicator={false}
              onTouchStart={notifyBlockedSwipeTouchStart}
              contentContainerStyle={styles.suiteScrollContent}
              ListHeaderComponent={
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
                        selectedSuiteId === 'all'
                          ? colors.primary
                          : colors.border,
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
              }
              ListFooterComponent={
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
              }
            />

            {/* Priority & Status Filter Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onTouchStart={notifyBlockedSwipeTouchStart}
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
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter by status: ${
                      st === 'all' ? 'All Status' : st
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
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Filter by test type: ${
                      tp === 'all' ? 'All Types' : tp
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
                      {tp === 'all' ? 'All Types' : tp}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <FlatList
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            data={filteredTestCases}
            keyExtractor={caseKeyExtractor}
            renderItem={renderTestCaseItem}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
            ListHeaderComponent={
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
                    accessibilityRole="button"
                    accessibilityLabel="Reset test case filters"
                  >
                    <Text style={[styles.resetText, { color: colors.primary }]}>
                      Reset Filters
                    </Text>
                  </Pressable>
                )}
              </View>
            }
            ListEmptyComponent={
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
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
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
                  accessibilityRole="button"
                  accessibilityLabel="Create Test Case"
                  style={[
                    styles.emptyCta,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.emptyCtaText}>+ Create Test Case</Text>
                </Pressable>
              </View>
            }
          />
        </>
      )}

      {/* ===================================================================
          SUB-VIEW 2: TEST SUITES
         =================================================================== */}
      {subTab === 'suites' && (
        <FlatList
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          data={suites}
          keyExtractor={suiteDetailKeyExtractor}
          renderItem={renderSuiteDetailItem}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
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
                  Organize project test cases into logical functional,
                  regression, or security suites.
                </Text>
              </View>
              <Pressable
                onPress={openCreateSuiteModal}
                accessibilityRole="button"
                accessibilityLabel="New Suite"
                style={[
                  styles.primaryActionBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <VectorIcon name="plus" size={14} color="#ffffff" />
                <Text style={styles.primaryActionBtnText}>New Suite</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
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
                accessibilityRole="button"
                accessibilityLabel="Create First Suite"
                style={[styles.emptyCta, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.emptyCtaText}>+ Create First Suite</Text>
              </Pressable>
            </View>
          }
        />
      )}

      {/* ===================================================================
          SUB-VIEW 3: TEST PLAN
         =================================================================== */}
      {subTab === 'plan' && (
        <FlatList
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          data={planPhases}
          keyExtractor={phaseKeyExtractor}
          renderItem={renderPhaseItem}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          ListHeaderComponent={
            <View style={{ gap: 10 }}>
              {/* Test Plan Master Header Card */}
              <View
                style={[
                  styles.planHeaderCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
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
                    <Text style={[styles.planTitle, { color: colors.text }]}>
                      {testPlan?.name ||
                        `${activeProject?.name || 'Project'} Master Test Plan`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={openEditPlanModal}
                    accessibilityRole="button"
                    accessibilityLabel="Edit Plan"
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
                      style={[
                        styles.planMetricLbl,
                        { color: colors.textMuted },
                      ]}
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
                      style={[
                        styles.planMetricLbl,
                        { color: colors.textMuted },
                      ]}
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
                      style={[
                        styles.planMetricLbl,
                        { color: colors.textMuted },
                      ]}
                    >
                      Test Cases
                    </Text>
                  </View>
                  <View style={styles.planMetricBox}>
                    <Text
                      style={[styles.planMetricVal, { color: colors.primary }]}
                    >
                      {populatedPlanSections.length}/{planDocSections.length}
                    </Text>
                    <Text
                      style={[
                        styles.planMetricLbl,
                        { color: colors.textMuted },
                      ]}
                    >
                      Sections
                    </Text>
                  </View>
                </View>
              </View>

              {/* Testing Phases Header Card (`testPlan.phases`) */}
              <View
                style={[
                  styles.planSectionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
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
                    accessibilityRole="button"
                    accessibilityLabel="Add Testing Phase"
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
              </View>
            </View>
          }
          ListEmptyComponent={
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
          }
          ListFooterComponent={
            <View
              style={[
                styles.planSectionCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.planSectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.planSectionTitle, { color: colors.text }]}
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
                    No test plan specification details have been authored yet.
                    Tap &quot;Edit Plan&quot; to document objectives, scope,
                    strategy, and criteria.
                  </Text>
                  <Pressable
                    onPress={openEditPlanModal}
                    accessibilityRole="button"
                    accessibilityLabel="Author Test Plan Details"
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
                            color: hasVal ? colors.text : colors.textMuted,
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
          }
        />
      )}

      <TestCaseDetailModal
        selectedTestCase={selectedTestCase}
        setSelectedTestCaseId={setSelectedTestCaseId}
        executionStatuses={executionStatuses}
        getStatusBadgeStyle={getStatusBadgeStyle}
        updateTestCase={updateTestCase}
        suites={suites}
        moveTestCaseToSuite={moveTestCaseToSuite}
        setDeletingCase={setDeletingCase}
        openEditCaseModal={openEditCaseModal}
      />

      <TestCaseFormModal
        isFormModalOpen={isFormModalOpen}
        setIsFormModalOpen={setIsFormModalOpen}
        isSubmittingCase={isSubmittingCase}
        editingCase={editingCase}
        caseFormScrollRef={caseFormScrollRef}
        caseFormError={caseFormError}
        caseTitleRef={caseTitleRef}
        formTitle={formTitle}
        setFormTitle={setFormTitle}
        scrollModalTo={scrollModalTo}
        caseTagsRef={caseTagsRef}
        suites={suites}
        formSuiteId={formSuiteId}
        setFormSuiteId={setFormSuiteId}
        priorities={priorities}
        formPriority={formPriority}
        setFormPriority={setFormPriority}
        testTypes={testTypes}
        formTestType={formTestType}
        setFormTestType={setFormTestType}
        formTags={formTags}
        setFormTags={setFormTags}
        caseDescRef={caseDescRef}
        formDescription={formDescription}
        setFormDescription={setFormDescription}
        casePreconditionsRef={casePreconditionsRef}
        formPreconditions={formPreconditions}
        setFormPreconditions={setFormPreconditions}
        addStepRow={addStepRow}
        formSteps={formSteps}
        removeStepRow={removeStepRow}
        handleStepChange={handleStepChange}
        caseExpectedResultRef={caseExpectedResultRef}
        formExpectedResult={formExpectedResult}
        setFormExpectedResult={setFormExpectedResult}
        handleSaveTestCase={handleSaveTestCase}
      />

      <TestCaseMoveModal
        movingCase={movingCase}
        setMovingCase={setMovingCase}
        isMovingCase={isMovingCase}
        suites={suites}
        moveTargetSuiteId={moveTargetSuiteId}
        setMoveTargetSuiteId={setMoveTargetSuiteId}
        handleConfirmMoveCase={handleConfirmMoveCase}
      />

      <TestCaseDeleteModal
        deletingCase={deletingCase}
        setDeletingCase={setDeletingCase}
        isDeletingCase={isDeletingCase}
        handleConfirmDeleteCase={handleConfirmDeleteCase}
      />

      <TestSuiteFormModal
        isSuiteModalOpen={isSuiteModalOpen}
        setIsSuiteModalOpen={setIsSuiteModalOpen}
        isSubmittingSuite={isSubmittingSuite}
        editingSuite={editingSuite}
        suiteFormScrollRef={suiteFormScrollRef}
        suiteFormError={suiteFormError}
        suiteNameRef={suiteNameRef}
        suiteNameInput={suiteNameInput}
        setSuiteNameInput={setSuiteNameInput}
        scrollModalTo={scrollModalTo}
        suiteTagsRef={suiteTagsRef}
        suiteCategories={suiteCategories}
        suiteCategoryInput={suiteCategoryInput}
        setSuiteCategoryInput={setSuiteCategoryInput}
        planPhases={planPhases}
        suitePhaseIdInput={suitePhaseIdInput}
        setSuitePhaseIdInput={setSuitePhaseIdInput}
        suiteTagsInput={suiteTagsInput}
        setSuiteTagsInput={setSuiteTagsInput}
        suiteDescRef={suiteDescRef}
        suiteDescInput={suiteDescInput}
        setSuiteDescInput={setSuiteDescInput}
        handleSaveSuite={handleSaveSuite}
      />

      <TestSuiteDeleteModal
        deletingSuite={deletingSuite}
        setDeletingSuite={setDeletingSuite}
        isDeletingSuite={isDeletingSuite}
        suiteStatsMap={suiteStatsMap}
        suites={suites}
        suiteDeleteMode={suiteDeleteMode}
        setSuiteDeleteMode={setSuiteDeleteMode}
        suiteDeleteTargetId={suiteDeleteTargetId}
        setSuiteDeleteTargetId={setSuiteDeleteTargetId}
        handleConfirmDeleteSuite={handleConfirmDeleteSuite}
      />

      <TestPlanFormModal
        isPlanModalOpen={isPlanModalOpen}
        setIsPlanModalOpen={setIsPlanModalOpen}
        isSubmittingPlan={isSubmittingPlan}
        planFormScrollRef={planFormScrollRef}
        planFormError={planFormError}
        planForm={planForm}
        handlePlanFieldChange={handlePlanFieldChange}
        scrollModalTo={scrollModalTo}
        handleSavePlan={handleSavePlan}
      />

      <TestPhaseFormModal
        isPhaseModalOpen={isPhaseModalOpen}
        setIsPhaseModalOpen={setIsPhaseModalOpen}
        isSubmittingPhase={isSubmittingPhase}
        editingPhase={editingPhase}
        phaseFormError={phaseFormError}
        phaseNameRef={phaseNameRef}
        phaseNameInput={phaseNameInput}
        setPhaseNameInput={setPhaseNameInput}
        phaseDescRef={phaseDescRef}
        phaseDescInput={phaseDescInput}
        setPhaseDescInput={setPhaseDescInput}
        handleSavePhase={handleSavePhase}
      />

      <TestPhaseDeleteModal
        deletingPhase={deletingPhase}
        setDeletingPhase={setDeletingPhase}
        isDeletingPhase={isDeletingPhase}
        handleConfirmDeletePhase={handleConfirmDeletePhase}
      />
    </View>
  );
}

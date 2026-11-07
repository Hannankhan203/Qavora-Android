import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useWorkspace } from '../context/WorkspaceContext';

export default function TestCasesScreen() {
  const { colors } = useTheme();
  const {
    suites,
    testCases,
    defects,
    priorities,
    testTypes,
    executionStatuses,
    selectedTestCaseId,
    setSelectedTestCaseId,
    createSuite,
    deleteSuite,
    createTestCase,
    updateTestCase,
    deleteTestCase,
    setSelectedDefectId,
    setActiveTab,
  } = useWorkspace();

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSuiteFilter, setSelectedSuiteFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Suite Creation State
  const [isAddingSuite, setIsAddingSuite] = useState(false);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [newSuiteDesc, setNewSuiteDesc] = useState('');

  // Create / Edit Test Case Modal State
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formSuiteId, setFormSuiteId] = useState(suites[0]?.id || 'suite-auth');
  const [formPriority, setFormPriority] = useState('P1');
  const [formTestType, setFormTestType] = useState('Functional');
  const [formDescription, setFormDescription] = useState('');
  const [formPreconditions, setFormPreconditions] = useState('');
  const [formExpectedResult, setFormExpectedResult] = useState('');
  const [formSteps, setFormSteps] = useState([
    { id: 'st-init-1', action: '', expectedResult: '' },
  ]);
  const [formError, setFormError] = useState('');

  const selectedCase = useMemo(
    () => testCases.find((tc) => tc.id === selectedTestCaseId) || null,
    [testCases, selectedTestCaseId]
  );

  const filteredCases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return testCases.filter((tc) => {
      if (selectedSuiteFilter !== 'all' && tc.suiteId !== selectedSuiteFilter) return false;
      if (priorityFilter !== 'all' && tc.priority !== priorityFilter) return false;
      if (statusFilter !== 'all' && tc.lastStatus !== statusFilter) return false;
      if (q) {
        const hay = `${tc.id} ${tc.title} ${tc.description} ${tc.suiteName} ${tc.testType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [testCases, searchQuery, selectedSuiteFilter, priorityFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingCaseId(null);
    setFormTitle('');
    setFormSuiteId(
      selectedSuiteFilter !== 'all' ? selectedSuiteFilter : suites[0]?.id || 'suite-auth'
    );
    setFormPriority('P1');
    setFormTestType('Functional');
    setFormDescription('');
    setFormPreconditions('');
    setFormExpectedResult('');
    setFormSteps([{ id: `st-${Date.now()}`, action: '', expectedResult: '' }]);
    setFormError('');
    setIsFormModalOpen(true);
  };

  const openEditModal = (tc) => {
    setSelectedTestCaseId(null);
    setEditingCaseId(tc.id);
    setFormTitle(tc.title);
    setFormSuiteId(tc.suiteId);
    setFormPriority(tc.priority);
    setFormTestType(tc.testType);
    setFormDescription(tc.description || '');
    setFormPreconditions(tc.preconditions || '');
    setFormExpectedResult(tc.expectedResult || '');
    setFormSteps(
      tc.steps && tc.steps.length > 0
        ? tc.steps.map((s) => ({
            id: s.id || `st-${Math.random()}`,
            action: s.action,
            expectedResult: s.expectedResult,
          }))
        : [{ id: `st-${Date.now()}`, action: '', expectedResult: '' }]
    );
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleSaveTestCase = () => {
    setFormError('');
    if (!formTitle.trim()) {
      setFormError('Test Case title is required.');
      return;
    }
    const validSteps = formSteps.filter((s) => s.action.trim().length > 0);
    if (validSteps.length === 0) {
      setFormError('Please provide at least one test step action.');
      return;
    }
    if (!formExpectedResult.trim()) {
      setFormError('Overall expected result is required.');
      return;
    }

    if (editingCaseId) {
      updateTestCase(editingCaseId, {
        suiteId: formSuiteId,
        title: formTitle,
        description: formDescription,
        preconditions: formPreconditions,
        priority: formPriority,
        testType: formTestType,
        steps: validSteps,
        expectedResult: formExpectedResult,
      });
    } else {
      createTestCase({
        suiteId: formSuiteId,
        title: formTitle,
        description: formDescription,
        preconditions: formPreconditions,
        priority: formPriority,
        testType: formTestType,
        steps: validSteps,
        expectedResult: formExpectedResult,
      });
    }
    setIsFormModalOpen(false);
  };

  const handleCreateSuite = () => {
    if (!newSuiteName.trim()) return;
    const created = createSuite({ name: newSuiteName, description: newSuiteDesc });
    if (created) {
      setNewSuiteName('');
      setNewSuiteDesc('');
      setIsAddingSuite(false);
      setSelectedSuiteFilter(created.id);
    }
  };

  const addStepRow = () => {
    setFormSteps((prev) => [
      ...prev,
      { id: `st-${Date.now()}-${prev.length}`, action: '', expectedResult: '' },
    ]);
  };

  const updateStepField = (id, field, value) => {
    setFormSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const removeStepRow = (id) => {
    if (formSteps.length <= 1) return;
    setFormSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const getStatusColor = (status) => {
    if (status === 'Passed') return colors.success;
    if (status === 'Failed') return colors.danger;
    if (status === 'Blocked') return colors.warning;
    return colors.textMuted;
  };

  const getPriorityColor = (priority) => {
    if (priority === 'P0') return colors.danger;
    if (priority === 'P1') return colors.warning;
    if (priority === 'P2') return colors.primary;
    return colors.textMuted;
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header & Actions */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text
              style={[
                styles.kicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              TEST REPOSITORY · {testCases.length} CASES · {suites.length} SUITES
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Test Suites & Test Cases
            </Text>
          </View>
          <View style={styles.headerButtons}>
            <Pressable
              onPress={() => setIsAddingSuite(!isAddingSuite)}
              style={[
                styles.suiteAddBtn,
                { backgroundColor: colors.surface, borderColor: colors.borderStrong },
              ]}
            >
              <Text style={[styles.suiteAddBtnText, { color: colors.text }]}>
                + Suite
              </Text>
            </Pressable>
            <Pressable
              onPress={openCreateModal}
              style={[styles.createBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.createBtnText, { color: colors.textOnPrimary }]}>
                + New Case
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Inline New Suite Creator */}
        {isAddingSuite ? (
          <View
            style={[
              styles.inlineSuiteBox,
              { backgroundColor: colors.surface, borderColor: colors.primary },
            ]}
          >
            <Text style={[styles.inlineSuiteTitle, { color: colors.text }]}>
              Create New Test Suite
            </Text>
            <TextInput
              value={newSuiteName}
              onChangeText={setNewSuiteName}
              placeholder="Suite Name (e.g., Payment & Checkout)"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
            />
            <TextInput
              value={newSuiteDesc}
              onChangeText={setNewSuiteDesc}
              placeholder="Suite scope description..."
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
            />
            <View style={styles.inlineSuiteActions}>
              <Pressable
                onPress={() => setIsAddingSuite(false)}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleCreateSuite}
                style={[styles.primarySmallBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.primarySmallBtnText, { color: colors.textOnPrimary }]}>
                  Save Suite
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Search Input */}
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search ID (TC-101), title, suite, or type..."
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery('')}
              style={styles.clearBtn}
            >
              <Text style={[styles.clearBtnText, { color: colors.textMuted }]}>
                Clear
              </Text>
            </Pressable>
          )}
        </View>

        {/* Suite Filter Strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
        >
          <Pressable
            onPress={() => setSelectedSuiteFilter('all')}
            style={[
              styles.filterChip,
              {
                backgroundColor:
                  selectedSuiteFilter === 'all' ? colors.primary : colors.surface,
                borderColor:
                  selectedSuiteFilter === 'all' ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                {
                  color:
                    selectedSuiteFilter === 'all'
                      ? colors.textOnPrimary
                      : colors.textSecondary,
                },
              ]}
            >
              All Suites ({testCases.length})
            </Text>
          </Pressable>

          {suites.map((suite) => {
            const count = testCases.filter((tc) => tc.suiteId === suite.id).length;
            const active = selectedSuiteFilter === suite.id;
            return (
              <Pressable
                key={suite.id}
                onPress={() => setSelectedSuiteFilter(suite.id)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? colors.textOnPrimary : colors.textSecondary },
                  ]}
                >
                  {suite.name} ({count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Priority & Status Filter Row */}
        <View style={styles.secondaryFilterRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subStrip}
          >
            <Pressable
              onPress={() => setPriorityFilter('all')}
              style={[
                styles.subChip,
                priorityFilter === 'all' && { backgroundColor: colors.surfaceAccent },
              ]}
            >
              <Text
                style={[
                  styles.subChipText,
                  { color: priorityFilter === 'all' ? colors.primary : colors.textMuted },
                ]}
              >
                All Priorities
              </Text>
            </Pressable>
            {priorities.map((p) => {
              const active = priorityFilter === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPriorityFilter(active ? 'all' : p)}
                  style={[
                    styles.subChip,
                    active && { backgroundColor: colors.surfaceAccent },
                  ]}
                >
                  <Text
                    style={[
                      styles.subChipText,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {p}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={[styles.stripSep, { color: colors.borderStrong }]}>|</Text>

            {executionStatuses.map((st) => {
              const active = statusFilter === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => setStatusFilter(active ? 'all' : st)}
                  style={[
                    styles.subChip,
                    active && { backgroundColor: colors.surfaceAccent },
                  ]}
                >
                  <Text
                    style={[
                      styles.subChipText,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {st}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {selectedSuiteFilter !== 'all' && suites.length > 1 && (
            <Pressable
              onPress={() => {
                deleteSuite(selectedSuiteFilter);
                setSelectedSuiteFilter('all');
              }}
              style={styles.deleteSuiteBtn}
            >
              <Text style={[styles.deleteSuiteText, { color: colors.danger }]}>
                Delete Suite
              </Text>
            </Pressable>
          )}
        </View>

        {/* Test Cases List */}
        {filteredCases.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No matching test cases
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              Adjust your search/filters or create a new QA test case in this suite.
            </Text>
            <View style={styles.emptyBtnRow}>
              <Pressable
                onPress={() => {
                  setSearchQuery('');
                  setSelectedSuiteFilter('all');
                  setPriorityFilter('all');
                  setStatusFilter('all');
                }}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                  Reset Filters
                </Text>
              </Pressable>
              <Pressable
                onPress={openCreateModal}
                style={[styles.primarySmallBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.primarySmallBtnText, { color: colors.textOnPrimary }]}>
                  + Create Test Case
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.caseList}>
            {filteredCases.map((tc) => (
              <Pressable
                key={tc.id}
                onPress={() => setSelectedTestCaseId(tc.id)}
                style={[
                  styles.caseCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.caseMetaRow}>
                  <Text
                    style={[
                      styles.caseId,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {tc.id}
                  </Text>
                  <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                  <Text
                    style={[
                      styles.casePriority,
                      { color: getPriorityColor(tc.priority), fontFamily: monoFontFamily },
                    ]}
                  >
                    {tc.priority}
                  </Text>
                  <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                  <Text style={[styles.caseType, { color: colors.textSecondary }]}>
                    {tc.testType}
                  </Text>
                  <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                  <Text
                    style={[
                      styles.caseStatus,
                      { color: getStatusColor(tc.lastStatus), fontFamily: monoFontFamily },
                    ]}
                  >
                    {tc.lastStatus.toUpperCase()}
                  </Text>
                </View>

                <Text style={[styles.caseTitle, { color: colors.text }]}>
                  {tc.title}
                </Text>

                <Text
                  numberOfLines={2}
                  style={[styles.caseExpected, { color: colors.textSecondary }]}
                >
                  Expected: {tc.expectedResult}
                </Text>

                <View style={[styles.caseFooter, { borderTopColor: colors.border }]}>
                  <Text
                    style={[
                      styles.caseFooterMeta,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    Suite: {tc.suiteName} · {tc.steps.length} steps
                  </Text>

                  <View style={styles.caseQuickActions}>
                    <Pressable
                      onPress={() => openEditModal(tc)}
                      style={[
                        styles.rowActionBtn,
                        { backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.rowActionText, { color: colors.text }]}>
                        Edit
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteTestCase(tc.id)}
                      style={[
                        styles.rowActionBtn,
                        { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                      ]}
                    >
                      <Text style={[styles.rowActionText, { color: colors.danger }]}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Test Case Detail Inspection Modal */}
      <Modal
        visible={Boolean(selectedCase)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedTestCaseId(null)}
      >
        {selectedCase ? (
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />

              <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
                <View style={styles.modalMetaCol}>
                  <Text
                    style={[
                      styles.modalCode,
                      { color: colors.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {selectedCase.id} · {selectedCase.priority} · {selectedCase.testType}
                  </Text>
                  <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                    Suite: {selectedCase.suiteName} · Status: {selectedCase.lastStatus}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSelectedTestCaseId(null)}
                  style={[
                    styles.closeBtn,
                    { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.closeBtnText, { color: colors.text }]}>
                    Close
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.modalBody}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.detailTitle, { color: colors.text }]}>
                  {selectedCase.title}
                </Text>

                {selectedCase.description ? (
                  <Text style={[styles.detailDesc, { color: colors.textSecondary }]}>
                    {selectedCase.description}
                  </Text>
                ) : null}

                <View
                  style={[
                    styles.infoBlock,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.blockLabel, { color: colors.text }]}>
                    Preconditions
                  </Text>
                  <Text style={[styles.blockText, { color: colors.textSecondary }]}>
                    {selectedCase.preconditions || 'None specified.'}
                  </Text>
                </View>

                <Text style={[styles.sectionHeader, { color: colors.text }]}>
                  Test Steps ({selectedCase.steps.length})
                </Text>

                {selectedCase.steps.map((st, idx) => (
                  <View
                    key={st.id || idx}
                    style={[
                      styles.stepCard,
                      { backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepNum,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      STEP {idx + 1}
                    </Text>
                    <Text style={[styles.stepAction, { color: colors.text }]}>
                      Action: {st.action}
                    </Text>
                    {st.expectedResult ? (
                      <Text style={[styles.stepExpected, { color: colors.textSecondary }]}>
                        Expected: {st.expectedResult}
                      </Text>
                    ) : null}
                  </View>
                ))}

                <View
                  style={[
                    styles.infoBlock,
                    { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.blockLabel, { color: colors.text }]}>
                    Overall Expected Result
                  </Text>
                  <Text style={[styles.blockText, { color: colors.textSecondary }]}>
                    {selectedCase.expectedResult}
                  </Text>
                </View>

                {/* Linked Defects */}
                {defects.filter((d) => d.linkedTestCaseId === selectedCase.id).length > 0 && (
                  <View style={styles.linkedSection}>
                    <Text style={[styles.sectionHeader, { color: colors.text }]}>
                      Linked Defects
                    </Text>
                    {defects
                      .filter((d) => d.linkedTestCaseId === selectedCase.id)
                      .map((bug) => (
                        <Pressable
                          key={bug.id}
                          onPress={() => {
                            setSelectedTestCaseId(null);
                            setSelectedDefectId(bug.id);
                            setActiveTab('defects');
                          }}
                          style={[
                            styles.linkedBugCard,
                            { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                          ]}
                        >
                          <Text
                            style={[
                              styles.linkedBugText,
                              { color: colors.danger, fontFamily: monoFontFamily },
                            ]}
                          >
                            {bug.id} ({bug.severity}) · {bug.title} →
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                )}

                <View style={styles.detailActionRow}>
                  <Pressable
                    onPress={() => openEditModal(selectedCase)}
                    style={[styles.primaryModalBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.primaryModalBtnText, { color: colors.textOnPrimary }]}>
                      Edit Test Case
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => deleteTestCase(selectedCase.id)}
                    style={[
                      styles.deleteModalBtn,
                      { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                    ]}
                  >
                    <Text style={[styles.deleteModalBtnText, { color: colors.danger }]}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Create / Edit Test Case Modal with KeyboardAvoidingView */}
      <Modal
        visible={isFormModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFormModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />

            <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
              <Text style={[styles.detailTitle, { color: colors.text, marginBottom: 0 }]}>
                {editingCaseId ? `Edit ${editingCaseId}` : 'Create New Test Case'}
              </Text>
              <Pressable
                onPress={() => setIsFormModalOpen(false)}
                style={[
                  styles.closeBtn,
                  { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.closeBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              {formError ? (
                <View
                  style={[
                    styles.errorBanner,
                    { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                  ]}
                >
                  <Text style={[styles.errorBannerText, { color: colors.danger }]}>
                    {formError}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Case Title *
              </Text>
              <TextInput
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="Verify user can reset password with valid token"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Suite
              </Text>
              <View style={styles.choiceGrid}>
                {suites.map((sq) => {
                  const active = formSuiteId === sq.id;
                  return (
                    <Pressable
                      key={sq.id}
                      onPress={() => setFormSuiteId(sq.id)}
                      style={[
                        styles.choicePill,
                        {
                          backgroundColor: active ? colors.primary : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choicePillText,
                          { color: active ? colors.textOnPrimary : colors.text },
                        ]}
                      >
                        {sq.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Priority (P0–P3)
              </Text>
              <View style={styles.choiceGrid}>
                {priorities.map((p) => {
                  const active = formPriority === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setFormPriority(p)}
                      style={[
                        styles.choicePill,
                        {
                          backgroundColor: active ? colors.surfaceAccent : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choicePillText,
                          { color: active ? colors.primary : colors.textSecondary },
                        ]}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Test Type
              </Text>
              <View style={styles.choiceGrid}>
                {testTypes.map((t) => {
                  const active = formTestType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setFormTestType(t)}
                      style={[
                        styles.choicePill,
                        {
                          backgroundColor: active ? colors.surfaceAccent : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choicePillText,
                          { color: active ? colors.primary : colors.textSecondary },
                        ]}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Description
              </Text>
              <TextInput
                value={formDescription}
                onChangeText={setFormDescription}
                multiline
                placeholder="Objective and scope of this test case..."
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Preconditions
              </Text>
              <TextInput
                value={formPreconditions}
                onChangeText={setFormPreconditions}
                placeholder="Test environment or user state required before execution..."
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              {/* Interactive Step Builder */}
              <View style={styles.stepsHeaderRow}>
                <Text style={[styles.fieldLabel, { color: colors.text, marginBottom: 0 }]}>
                  Test Steps *
                </Text>
                <Pressable
                  onPress={addStepRow}
                  style={[
                    styles.addStepBtn,
                    { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.addStepBtnText, { color: colors.primary }]}>
                    + Add Step
                  </Text>
                </Pressable>
              </View>

              {formSteps.map((step, idx) => (
                <View
                  key={step.id}
                  style={[
                    styles.stepBuilderCard,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.stepBuilderTop}>
                    <Text
                      style={[
                        styles.stepNum,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      STEP {idx + 1}
                    </Text>
                    {formSteps.length > 1 && (
                      <Pressable onPress={() => removeStepRow(step.id)}>
                        <Text style={[styles.removeStepText, { color: colors.danger }]}>
                          Remove
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    value={step.action}
                    onChangeText={(v) => updateStepField(step.id, 'action', v)}
                    placeholder={`Step ${idx + 1} action...`}
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.stepInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                  />
                  <TextInput
                    value={step.expectedResult}
                    onChangeText={(v) => updateStepField(step.id, 'expectedResult', v)}
                    placeholder={`Step ${idx + 1} expected result...`}
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.stepInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                  />
                </View>
              ))}

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Overall Expected Result *
              </Text>
              <TextInput
                value={formExpectedResult}
                onChangeText={setFormExpectedResult}
                multiline
                placeholder="Final expected outcome when all steps pass..."
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <Pressable
                onPress={handleSaveTestCase}
                style={[styles.saveCaseBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.saveCaseBtnText, { color: colors.textOnPrimary }]}>
                  {editingCaseId ? 'Save Test Case Changes' : 'Create Test Case'}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 96,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 180,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  suiteAddBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suiteAddBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  createBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  inlineSuiteBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  inlineSuiteTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  inlineSuiteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 46,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  clearBtn: {
    minHeight: 40,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 10,
  },
  filterChip: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  subStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stripSep: {
    fontSize: 13,
    marginHorizontal: 4,
  },
  deleteSuiteBtn: {
    minHeight: 34,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  deleteSuiteText: {
    fontSize: 12,
    fontWeight: '600',
  },
  caseList: {
    gap: 10,
  },
  caseCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  caseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  caseId: {
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    fontSize: 12,
  },
  casePriority: {
    fontSize: 12,
    fontWeight: '700',
  },
  caseType: {
    fontSize: 12,
  },
  caseStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  caseTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 4,
  },
  caseExpected: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  caseFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  caseFooterMeta: {
    fontSize: 11,
    flexShrink: 1,
  },
  caseQuickActions: {
    flexDirection: 'row',
    gap: 6,
  },
  rowActionBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 14,
  },
  emptyBtnRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  secondaryBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primarySmallBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySmallBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '92%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingBottom: 20,
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  modalTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  modalMetaCol: {
    flex: 1,
  },
  modalCode: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 12,
  },
  closeBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBody: {
    padding: 16,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    marginBottom: 8,
  },
  detailDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  infoBlock: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  blockText: {
    fontSize: 13,
    lineHeight: 19,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  stepCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepAction: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginBottom: 4,
  },
  stepExpected: {
    fontSize: 12,
    lineHeight: 18,
  },
  linkedSection: {
    marginTop: 6,
    marginBottom: 14,
  },
  linkedBugCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 6,
  },
  linkedBugText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryModalBtn: {
    flex: 2,
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  deleteModalBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 74,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  choicePill: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choicePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  addStepBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addStepBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepBuilderCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  stepBuilderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  removeStepText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    marginBottom: 6,
  },
  saveCaseBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveCaseBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

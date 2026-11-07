import React, { useState, useEffect, useMemo } from 'react';
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

export default function DefectsScreen() {
  const { colors } = useTheme();
  const {
    profile,
    defects,
    testCases,
    defectSeverities,
    defectStatuses,
    selectedDefectId,
    setSelectedDefectId,
    draftDefectFromExecution,
    setDraftDefectFromExecution,
    createDefect,
    updateDefect,
    deleteDefect,
    setSelectedTestCaseId,
    setActiveTab,
  } = useWorkspace();

  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Create / Edit Defect Form Modal
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDefectId, setEditingDefectId] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('High');
  const [status, setStatus] = useState('Open');
  const [reproductionSteps, setReproductionSteps] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [environment, setEnvironment] = useState('');
  const [linkedTestCaseId, setLinkedTestCaseId] = useState(null);
  const [linkedTestRunId, setLinkedTestRunId] = useState(null);
  const [formError, setFormError] = useState('');

  // Automatically open pre-filled Create Defect modal when arriving from a failed test execution
  useEffect(() => {
    if (draftDefectFromExecution) {
      setEditingDefectId(null);
      setTitle(draftDefectFromExecution.title || '');
      setDescription(draftDefectFromExecution.description || '');
      setSeverity(draftDefectFromExecution.severity || 'High');
      setStatus(draftDefectFromExecution.status || 'Open');
      setReproductionSteps(draftDefectFromExecution.reproductionSteps || '');
      setExpectedResult(draftDefectFromExecution.expectedResult || '');
      setActualResult(draftDefectFromExecution.actualResult || '');
      setEnvironment(draftDefectFromExecution.environment || '');
      setLinkedTestCaseId(draftDefectFromExecution.linkedTestCaseId || null);
      setLinkedTestRunId(draftDefectFromExecution.linkedTestRunId || null);
      setFormError('');
      setIsFormOpen(true);
      setDraftDefectFromExecution(null);
    }
  }, [draftDefectFromExecution, setDraftDefectFromExecution]);

  const selectedDefect = useMemo(
    () => defects.find((d) => d.id === selectedDefectId) || null,
    [defects, selectedDefectId]
  );

  const filteredDefects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return defects.filter((bug) => {
      if (severityFilter !== 'all' && bug.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && bug.status !== statusFilter) return false;
      if (q) {
        const hay = `${bug.id} ${bug.title} ${bug.description} ${bug.linkedTestCaseId || ''} ${bug.environment || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [defects, searchQuery, severityFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingDefectId(null);
    setTitle('');
    setDescription('');
    setSeverity('High');
    setStatus('Open');
    setReproductionSteps('1. \n2. \n3. ');
    setExpectedResult('');
    setActualResult('');
    setEnvironment(`${profile.defaultDevice} · Build ${profile.defaultBuild}`);
    setLinkedTestCaseId(testCases[0]?.id || null);
    setLinkedTestRunId(null);
    setFormError('');
    setIsFormOpen(true);
  };

  const openEditModal = (bug) => {
    setSelectedDefectId(null);
    setEditingDefectId(bug.id);
    setTitle(bug.title);
    setDescription(bug.description || '');
    setSeverity(bug.severity);
    setStatus(bug.status);
    setReproductionSteps(bug.reproductionSteps || '');
    setExpectedResult(bug.expectedResult || '');
    setActualResult(bug.actualResult || '');
    setEnvironment(bug.environment || '');
    setLinkedTestCaseId(bug.linkedTestCaseId || null);
    setLinkedTestRunId(bug.linkedTestRunId || null);
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSaveDefect = () => {
    setFormError('');
    if (!title.trim()) {
      setFormError('Defect title is required.');
      return;
    }
    if (!reproductionSteps.trim()) {
      setFormError('Reproduction steps are required.');
      return;
    }
    if (!actualResult.trim()) {
      setFormError('Actual result is required.');
      return;
    }

    if (editingDefectId) {
      updateDefect(editingDefectId, {
        title,
        description,
        severity,
        status,
        reproductionSteps,
        expectedResult,
        actualResult,
        environment,
        linkedTestCaseId,
      });
    } else {
      createDefect({
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
      });
    }
    setIsFormOpen(false);
  };

  const getSeverityColor = (sev) => {
    if (sev === 'Critical') return colors.danger;
    if (sev === 'High') return colors.warning;
    if (sev === 'Medium') return colors.primary;
    return colors.textMuted;
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text
              style={[
                styles.kicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              DEFECT TRACKER · {defects.length} TOTAL ({defects.filter((d) => d.status !== 'Closed').length} OPEN)
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Defects & Bug Reports
            </Text>
          </View>
          <Pressable
            onPress={openCreateModal}
            style={[styles.createBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.createBtnText, { color: colors.textOnPrimary }]}>
              + Log Defect
            </Text>
          </Pressable>
        </View>

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
            placeholder="Search BUG-301, title, linked test case (TC-103)..."
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

        {/* Severity & Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
        >
          <Pressable
            onPress={() => {
              setSeverityFilter('all');
              setStatusFilter('all');
            }}
            style={[
              styles.filterChip,
              {
                backgroundColor:
                  severityFilter === 'all' && statusFilter === 'all'
                    ? colors.primary
                    : colors.surface,
                borderColor:
                  severityFilter === 'all' && statusFilter === 'all'
                    ? colors.primary
                    : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                {
                  color:
                    severityFilter === 'all' && statusFilter === 'all'
                      ? colors.textOnPrimary
                      : colors.textSecondary,
                },
              ]}
            >
              All ({defects.length})
            </Text>
          </Pressable>

          {defectSeverities.map((sev) => {
            const active = severityFilter === sev;
            return (
              <Pressable
                key={sev}
                onPress={() => setSeverityFilter(active ? 'all' : sev)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.surfaceAccent : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? colors.primary : colors.textSecondary },
                  ]}
                >
                  {sev}
                </Text>
              </Pressable>
            );
          })}

          {defectStatuses.map((st) => {
            const active = statusFilter === st;
            return (
              <Pressable
                key={st}
                onPress={() => setStatusFilter(active ? 'all' : st)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.surfaceAccent : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? colors.primary : colors.textSecondary },
                  ]}
                >
                  {st}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Defects List */}
        {filteredDefects.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No matching defects found
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              No defects match the active search or severity/status filter.
            </Text>
            <Pressable
              onPress={openCreateModal}
              style={[styles.createBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.createBtnText, { color: colors.textOnPrimary }]}>
                + Log New Defect
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.bugList}>
            {filteredDefects.map((bug) => (
              <Pressable
                key={bug.id}
                onPress={() => setSelectedDefectId(bug.id)}
                style={[
                  styles.bugCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.bugMetaRow}>
                  <Text
                    style={[
                      styles.bugId,
                      { color: getSeverityColor(bug.severity), fontFamily: monoFontFamily },
                    ]}
                  >
                    {bug.id}
                  </Text>
                  <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                  <Text
                    style={[
                      styles.bugSeverity,
                      { color: getSeverityColor(bug.severity), fontFamily: monoFontFamily },
                    ]}
                  >
                    {bug.severity.toUpperCase()}
                  </Text>
                  <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                  <Text style={[styles.bugStatus, { color: colors.textSecondary }]}>
                    {bug.status}
                  </Text>
                  {bug.linkedTestCaseId ? (
                    <>
                      <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                      <Text
                        style={[
                          styles.linkedCaseBadge,
                          { color: colors.primary, fontFamily: monoFontFamily },
                        ]}
                      >
                        Linked {bug.linkedTestCaseId}
                      </Text>
                    </>
                  ) : null}
                </View>

                <Text style={[styles.bugTitle, { color: colors.text }]}>
                  {bug.title}
                </Text>

                <Text
                  numberOfLines={2}
                  style={[styles.bugActual, { color: colors.textSecondary }]}
                >
                  Actual: {bug.actualResult}
                </Text>

                <View style={[styles.bugFooter, { borderTopColor: colors.border }]}>
                  <Text
                    style={[
                      styles.bugEnv,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    {bug.environment}
                  </Text>

                  <View style={styles.bugActionRow}>
                    <Pressable
                      onPress={() => openEditModal(bug)}
                      style={[
                        styles.smallActionBtn,
                        { backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.smallActionText, { color: colors.text }]}>
                        Edit
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteDefect(bug.id)}
                      style={[
                        styles.smallActionBtn,
                        { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                      ]}
                    >
                      <Text style={[styles.smallActionText, { color: colors.danger }]}>
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

      {/* Defect Detail Modal */}
      <Modal
        visible={Boolean(selectedDefect)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDefectId(null)}
      >
        {selectedDefect ? (
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.handleBar, { backgroundColor: colors.borderStrong }]} />

              <View style={[styles.modalTopBar, { borderBottomColor: colors.border }]}>
                <View style={styles.modalTitleCol}>
                  <Text
                    style={[
                      styles.modalCode,
                      {
                        color: getSeverityColor(selectedDefect.severity),
                        fontFamily: monoFontFamily,
                      },
                    ]}
                  >
                    {selectedDefect.id} · {selectedDefect.severity.toUpperCase()} · {selectedDefect.status}
                  </Text>
                  <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                    {selectedDefect.environment}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSelectedDefectId(null)}
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
                  {selectedDefect.title}
                </Text>

                {selectedDefect.description ? (
                  <Text style={[styles.detailDesc, { color: colors.textSecondary }]}>
                    {selectedDefect.description}
                  </Text>
                ) : null}

                {/* Status Progression Controls */}
                <Text style={[styles.sectionHeader, { color: colors.text }]}>
                  Defect Status Lifecycle
                </Text>
                <View style={styles.choiceGrid}>
                  {defectStatuses.map((st) => {
                    const active = selectedDefect.status === st;
                    return (
                      <Pressable
                        key={st}
                        onPress={() => updateDefect(selectedDefect.id, { status: st })}
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
                            { color: active ? colors.textOnPrimary : colors.textSecondary },
                          ]}
                        >
                          {st}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View
                  style={[
                    styles.infoBox,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.boxLabel, { color: colors.text }]}>
                    Steps to Reproduce
                  </Text>
                  <Text style={[styles.boxBody, { color: colors.textSecondary }]}>
                    {selectedDefect.reproductionSteps}
                  </Text>
                </View>

                <View
                  style={[
                    styles.infoBox,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.boxLabel, { color: colors.text }]}>
                    Expected Result
                  </Text>
                  <Text style={[styles.boxBody, { color: colors.textSecondary }]}>
                    {selectedDefect.expectedResult || 'See linked test case.'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.infoBox,
                    { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                  ]}
                >
                  <Text style={[styles.boxLabel, { color: colors.danger }]}>
                    Actual Result
                  </Text>
                  <Text style={[styles.boxBody, { color: colors.text }]}>
                    {selectedDefect.actualResult}
                  </Text>
                </View>

                {selectedDefect.linkedTestCaseId ? (
                  <Pressable
                    onPress={() => {
                      const targetId = selectedDefect.linkedTestCaseId;
                      setSelectedDefectId(null);
                      setSelectedTestCaseId(targetId);
                      setActiveTab('testcases');
                    }}
                    style={[
                      styles.linkedCaseBox,
                      { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.linkedCaseBoxText,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      Inspect Linked Test Case: {selectedDefect.linkedTestCaseId} →
                    </Text>
                  </Pressable>
                ) : null}

                <View style={styles.detailActionRow}>
                  <Pressable
                    onPress={() => openEditModal(selectedDefect)}
                    style={[styles.primaryModalBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.primaryModalBtnText, { color: colors.textOnPrimary }]}>
                      Edit Defect
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => deleteDefect(selectedDefect.id)}
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

      {/* Create / Edit Defect Form Modal */}
      <Modal
        visible={isFormOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFormOpen(false)}
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
                {editingDefectId ? `Edit ${editingDefectId}` : 'Log Defect Report'}
              </Text>
              <Pressable
                onPress={() => setIsFormOpen(false)}
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
                Defect Title *
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Brief summary of the bug..."
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
                Severity
              </Text>
              <View style={styles.choiceGrid}>
                {defectSeverities.map((sev) => {
                  const active = severity === sev;
                  return (
                    <Pressable
                      key={sev}
                      onPress={() => setSeverity(sev)}
                      style={[
                        styles.choicePill,
                        {
                          backgroundColor: active ? colors.surfaceAccent : colors.background,
                          borderColor: active ? getSeverityColor(sev) : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choicePillText,
                          { color: active ? getSeverityColor(sev) : colors.textSecondary },
                        ]}
                      >
                        {sev}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Status
              </Text>
              <View style={styles.choiceGrid}>
                {defectStatuses.map((st) => {
                  const active = status === st;
                  return (
                    <Pressable
                      key={st}
                      onPress={() => setStatus(st)}
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
                          { color: active ? colors.textOnPrimary : colors.textSecondary },
                        ]}
                      >
                        {st}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Linked Test Case
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.linkedPickerRow}
              >
                <Pressable
                  onPress={() => setLinkedTestCaseId(null)}
                  style={[
                    styles.choicePill,
                    {
                      backgroundColor:
                        linkedTestCaseId === null ? colors.primary : colors.background,
                      borderColor:
                        linkedTestCaseId === null ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      {
                        color:
                          linkedTestCaseId === null
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    None
                  </Text>
                </Pressable>
                {testCases.map((tc) => {
                  const active = linkedTestCaseId === tc.id;
                  return (
                    <Pressable
                      key={tc.id}
                      onPress={() => setLinkedTestCaseId(tc.id)}
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
                          {
                            color: active ? colors.textOnPrimary : colors.textSecondary,
                            fontFamily: monoFontFamily,
                          },
                        ]}
                      >
                        {tc.id}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Description
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                multiline
                placeholder="Additional context or impact..."
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
                Reproduction Steps *
              </Text>
              <TextInput
                value={reproductionSteps}
                onChangeText={setReproductionSteps}
                multiline
                placeholder="1. Navigate to...\n2. Tap on..."
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
                Expected Result
              </Text>
              <TextInput
                value={expectedResult}
                onChangeText={setExpectedResult}
                multiline
                placeholder="What should happen..."
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
                Actual Result *
              </Text>
              <TextInput
                value={actualResult}
                onChangeText={setActualResult}
                multiline
                placeholder="What actually happened..."
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
                Device & Build Environment
              </Text>
              <TextInput
                value={environment}
                onChangeText={setEnvironment}
                placeholder="Pixel 8 · Android 15 · Build 1.0.0"
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

              <Pressable
                onPress={handleSaveDefect}
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.saveBtnText, { color: colors.textOnPrimary }]}>
                  {editingDefectId ? 'Save Defect Changes' : 'Create Defect Report'}
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
    paddingBottom: 12,
  },
  filterChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bugList: {
    gap: 10,
  },
  bugCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  bugMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  bugId: {
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    fontSize: 12,
  },
  bugSeverity: {
    fontSize: 11,
    fontWeight: '700',
  },
  bugStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  linkedCaseBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  bugTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 4,
    flexShrink: 1,
  },
  bugActual: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
    flexShrink: 1,
  },
  bugFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  bugEnv: {
    fontSize: 11,
    flexShrink: 1,
  },
  bugActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  smallActionBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
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
  modalTitleCol: {
    flex: 1,
  },
  modalCode: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 11,
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
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
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
  linkedPickerRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 12,
  },
  infoBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  boxLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  boxBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  linkedCaseBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  linkedCaseBoxText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
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
  saveBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

import React, { useState, useEffect } from 'react';
import { Text, View, ScrollView, Pressable, Modal } from 'react-native';
import { useTheme, monoFontFamily } from '../../theme/theme';
import VectorIcon from '../VectorIcon';
import styles from './testCasesStyles';

export default function TestCaseDetailModal({
  selectedTestCase,
  setSelectedTestCaseId,
  executionStatuses,
  getStatusBadgeStyle,
  updateTestCase,
  suites,
  moveTestCaseToSuite,
  setDeletingCase,
  openEditCaseModal,
  isMutatingDetail: controlledIsMutatingDetail,
  onMutatingDetailChange,
}) {
  const { colors } = useTheme();
  const [localIsMutating, setLocalIsMutating] = useState(false);
  const [detailActionError, setDetailActionError] = useState('');
  const isMutating = Boolean(
    controlledIsMutatingDetail !== undefined
      ? controlledIsMutatingDetail
      : localIsMutating
  );

  const setMutating = (nextVal) => {
    setLocalIsMutating(Boolean(nextVal));
    if (typeof onMutatingDetailChange === 'function') {
      onMutatingDetailChange(Boolean(nextVal));
    }
  };

  const selectedCaseId = selectedTestCase?.id || null;
  useEffect(() => {
    setDetailActionError('');
  }, [selectedCaseId]);

  const handleClose = () => {
    if (isMutating) return;
    setDetailActionError('');
    setSelectedTestCaseId(null);
  };

  const handleQuickStatusUpdate = async (nextStatus) => {
    if (!selectedTestCase || isMutating) return;
    setDetailActionError('');
    setMutating(true);
    try {
      const res = await updateTestCase(selectedTestCase.id, {
        lastStatus: nextStatus,
      });
      if (res && res.ok === false) {
        setDetailActionError(
          res.error || 'Failed to update execution status.'
        );
      }
    } catch (err) {
      setDetailActionError(
        (err && err.message) || 'Failed to update execution status.'
      );
    } finally {
      setMutating(false);
    }
  };

  const handleQuickSuiteMove = async (targetSuiteId) => {
    if (!selectedTestCase || isMutating) return;
    setDetailActionError('');
    setMutating(true);
    try {
      const res = await moveTestCaseToSuite(
        selectedTestCase.id,
        targetSuiteId
      );
      if (res && res.ok === false) {
        setDetailActionError(res.error || 'Failed to move test case.');
      }
    } catch (err) {
      setDetailActionError(
        (err && err.message) || 'Failed to move test case.'
      );
    } finally {
      setMutating(false);
    }
  };

  return (
    <Modal
      visible={!!selectedTestCase}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View
        accessibilityViewIsModal={true}
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
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
                  onPress={handleClose}
                  disabled={isMutating}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isMutating }}
                  accessibilityLabel="Close test case details"
                  style={[
                    styles.closeCircle,
                    {
                      backgroundColor: colors.surfaceMuted,
                      opacity: isMutating ? 0.5 : 1,
                    },
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
                {detailActionError ? (
                  <View
                    style={[
                      styles.formAlertBox,
                      {
                        backgroundColor: colors.dangerSoft,
                        borderColor: colors.danger,
                        marginBottom: 10,
                      },
                    ]}
                  >
                    <Text style={[styles.formAlertText, { color: colors.danger }]}>
                      {detailActionError}
                    </Text>
                  </View>
                ) : null}
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
                  <View
                    accessibilityRole="radiogroup"
                    style={styles.quickStatusRow}
                  >
                    {executionStatuses.map((st) => {
                      const active = selectedTestCase.lastStatus === st;
                      const stStyle = getStatusBadgeStyle(st);
                      return (
                        <Pressable
                          key={st}
                          disabled={isMutating}
                          onPress={() => handleQuickStatusUpdate(st)}
                          accessibilityRole="radio"
                          accessibilityState={{
                            selected: active,
                            checked: active,
                            disabled: isMutating,
                          }}
                          accessibilityLabel={`Set execution status: ${st}`}
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
                    <View
                      accessibilityRole="radiogroup"
                      style={styles.optionChipsWrap}
                    >
                      {suites.map((s) => {
                        const isCurrent = s.id === selectedTestCase.suiteId;
                        return (
                          <Pressable
                            key={s.id}
                            disabled={isMutating}
                            onPress={() => {
                              if (!isCurrent) {
                                handleQuickSuiteMove(s.id);
                              }
                            }}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: isCurrent,
                              checked: isCurrent,
                              disabled: isMutating,
                            }}
                            accessibilityLabel={`Assign test case to suite ${s.name}`}
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
                  disabled={isMutating}
                  onPress={() => {
                    if (isMutating) return;
                    const target = selectedTestCase;
                    setSelectedTestCaseId(null);
                    setDeletingCase(target);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isMutating }}
                  accessibilityLabel={`Delete test case ${
                    selectedTestCase.testCaseId || selectedTestCase.id
                  }`}
                  style={[
                    styles.footerDangerBtn,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                      opacity: isMutating ? 0.55 : 1,
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
                  disabled={isMutating}
                  onPress={() => {
                    if (isMutating) return;
                    const tc = selectedTestCase;
                    setSelectedTestCaseId(null);
                    openEditCaseModal(tc);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isMutating }}
                  accessibilityLabel={`Edit test case ${
                    selectedTestCase.testCaseId || selectedTestCase.id
                  }`}
                  style={[
                    styles.footerSecondaryBtn,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      opacity: isMutating ? 0.55 : 1,
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
                  disabled={isMutating}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isMutating }}
                  accessibilityLabel="Done inspecting test case"
                  style={[
                    styles.footerPrimaryBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: isMutating ? 0.55 : 1,
                    },
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
  );
}

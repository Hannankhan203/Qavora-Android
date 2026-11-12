import React from 'react';
import {
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
import { useTheme } from '../../theme/theme';
import VectorIcon from '../VectorIcon';
import styles from './testCasesStyles';

export default function TestCaseFormModal({
  isFormModalOpen,
  setIsFormModalOpen,
  isSubmittingCase,
  editingCase,
  caseFormScrollRef,
  caseFormError,
  caseTitleRef,
  formTitle,
  setFormTitle,
  scrollModalTo,
  caseTagsRef,
  suites,
  formSuiteId,
  setFormSuiteId,
  priorities,
  formPriority,
  setFormPriority,
  testTypes,
  formTestType,
  setFormTestType,
  formTags,
  setFormTags,
  caseDescRef,
  formDescription,
  setFormDescription,
  casePreconditionsRef,
  formPreconditions,
  setFormPreconditions,
  addStepRow,
  formSteps,
  removeStepRow,
  handleStepChange,
  caseExpectedResultRef,
  formExpectedResult,
  setFormExpectedResult,
  handleSaveTestCase,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={isFormModalOpen}
      animationType="slide"
      transparent
      onRequestClose={() => !isSubmittingCase && setIsFormModalOpen(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            ref={caseFormScrollRef}
            style={styles.modalBody}
            contentContainerStyle={styles.modalBodyContent}
            keyboardShouldPersistTaps="handled"
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
              ref={caseTitleRef}
              value={formTitle}
              onChangeText={setFormTitle}
              placeholder="e.g., Verify biometric login fallback to PIN"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Test Case Title, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollModalTo(caseFormScrollRef, 0)}
              onSubmitEditing={() => caseTagsRef.current?.focus()}
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
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      accessibilityLabel={`Test Suite: ${s.name}`}
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
            <View
              accessibilityRole="radiogroup"
              style={styles.optionChipsWrap}
            >
              {priorities.map((p) => {
                const active = formPriority === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setFormPriority(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Priority: ${p}`}
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
            <View
              accessibilityRole="radiogroup"
              style={styles.optionChipsWrap}
            >
              {testTypes.map((t) => {
                const active = formTestType === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setFormTestType(t)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Test Type: ${t}`}
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
              ref={caseTagsRef}
              value={formTags}
              onChangeText={setFormTags}
              placeholder="e.g., auth, smoke, release-gate"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Test Case Tags, comma-separated"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollModalTo(caseFormScrollRef, 220)}
              onSubmitEditing={() => caseDescRef.current?.focus()}
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
              ref={caseDescRef}
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder="Brief summary of what this test validates..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Test Case Description or Objective"
              multiline
              onFocus={() => scrollModalTo(caseFormScrollRef, 300)}
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
              ref={casePreconditionsRef}
              value={formPreconditions}
              onChangeText={setFormPreconditions}
              placeholder="Required user state, test data, or configuration..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Test Case Preconditions"
              returnKeyType="next"
              onFocus={() => scrollModalTo(caseFormScrollRef, 390)}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add execution step"
                onPress={addStepRow}
              >
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
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove step ${index + 1}`}
                      onPress={() => removeStepRow(index)}
                    >
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
                  accessibilityLabel={`Step ${index + 1} Action`}
                  returnKeyType="next"
                  onFocus={() =>
                    scrollModalTo(caseFormScrollRef, 460 + index * 170)
                  }
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
                  accessibilityLabel={`Step ${index + 1} Test Data`}
                  returnKeyType="next"
                  onFocus={() =>
                    scrollModalTo(caseFormScrollRef, 500 + index * 170)
                  }
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
                  accessibilityLabel={`Step ${index + 1} Expected Result`}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onFocus={() =>
                    scrollModalTo(caseFormScrollRef, 540 + index * 170)
                  }
                  onSubmitEditing={() => {
                    if (index === formSteps.length - 1) {
                      caseExpectedResultRef.current?.focus();
                    }
                  }}
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
              ref={caseExpectedResultRef}
              value={formExpectedResult}
              onChangeText={setFormExpectedResult}
              placeholder="Final outcome when all steps succeed..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Overall Expected Result"
              multiline
              onFocus={() =>
                scrollModalTo(
                  caseFormScrollRef,
                  560 + formSteps.length * 170
                )
              }
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
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingCase) }}
              accessibilityLabel="Cancel test case form"
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
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingCase) }}
              accessibilityLabel={
                editingCase ? 'Save Changes' : 'Create Test Case'
              }
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
  );
}

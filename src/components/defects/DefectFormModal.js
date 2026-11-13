import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VectorIcon from '../VectorIcon';
import {
  DEFECT_SEVERITIES,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
} from '../../data/initialData';
import styles from './defectsStyles';

export default function DefectFormModal({
  theme,
  formModalVisible,
  setFormModalVisible,
  editingDefectId,
  formError,
  title,
  setTitle,
  severity,
  setSeverity,
  priority,
  setPriority,
  status,
  setStatus,
  linkedTestCaseId,
  setLinkedTestCaseId,
  handleSelectLinkedCaseInForm,
  testCases,
  linkedTestRunId,
  setLinkedTestRunId,
  testRuns,
  description,
  setDescription,
  reproSteps,
  setReproSteps,
  expectedResult,
  setExpectedResult,
  actualResult,
  setActualResult,
  environment,
  setEnvironment,
  externalUrl,
  setExternalUrl,
  isSubmittingDefect,
  handleSaveDefect,
  defectFormScrollRef,
  defectTitleRef,
  defectDescRef,
  defectReproRef,
  defectExpectedRef,
  defectActualRef,
  defectEnvRef,
  defectUrlRef,
  scrollDefectModalTo,
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={formModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => !isSubmittingDefect && setFormModalVisible(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.modalOverlay,
          {
            backgroundColor: theme.overlay,
            paddingTop: Math.max(16, insets.top),
          },
        ]}
      >
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: theme.border },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.modalTitle, { color: theme.text }]}
            >
              {editingDefectId
                ? `Edit Defect (${editingDefectId})`
                : 'Report New Defect'}
            </Text>
            <TouchableOpacity
              onPress={() => !isSubmittingDefect && setFormModalVisible(false)}
              disabled={Boolean(isSubmittingDefect)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingDefect) }}
              accessibilityLabel="Close defect form"
              style={[
                styles.closeBtn,
                {
                  backgroundColor: theme.surfaceMuted,
                  opacity: isSubmittingDefect ? 0.5 : 1,
                },
              ]}
            >
              <VectorIcon
                name="close"
                size={16}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={defectFormScrollRef}
            style={styles.modalScrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalBody}
          >
            {formError ? (
              <View
                style={[
                  styles.formErrorBox,
                  {
                    backgroundColor: theme.dangerSoft,
                    borderColor: theme.danger,
                  },
                ]}
              >
                <VectorIcon name="alert" size={14} color={theme.danger} />
                <Text
                  style={[styles.formErrorText, { color: theme.danger }]}
                >
                  {formError}
                </Text>
              </View>
            ) : null}

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Defect Title *
            </Text>
            <TextInput
              ref={defectTitleRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., Crash when rotating camera during QR scan"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Defect Title, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollDefectModalTo(0)}
              onSubmitEditing={() => defectDescRef.current?.focus()}
              value={title}
              onChangeText={setTitle}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Severity
            </Text>
            <View style={styles.optionRow} accessibilityRole="radiogroup">
              {DEFECT_SEVERITIES.map((s) => {
                const active = severity === s;
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setSeverity(s)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Defect severity: ${s}`}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: active
                          ? theme.dangerSoft
                          : theme.surfaceMuted,
                        borderColor: active ? theme.danger : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        {
                          color: active
                            ? theme.danger
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Priority
            </Text>
            <View style={styles.optionRow} accessibilityRole="radiogroup">
              {DEFECT_PRIORITIES.map((p) => {
                const active = priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setPriority(p)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Defect priority: ${p}`}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: active
                          ? theme.primarySoft
                          : theme.surfaceMuted,
                        borderColor: active ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        {
                          color: active
                            ? theme.primary
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {p}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Workflow Status
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 4 }}
            >
              {DEFECT_STATUSES.map((st) => {
                const active = status === st;
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() => setStatus(st)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Workflow status: ${st}`}
                    style={[
                      styles.caseSelectPill,
                      {
                        backgroundColor: active
                          ? theme.primarySoft
                          : theme.surfaceMuted,
                        borderColor: active ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.caseSelectText,
                        {
                          color: active
                            ? theme.primary
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {st}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Linked Test Case
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 4 }}
            >
              <TouchableOpacity
                onPress={() => setLinkedTestCaseId('')}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: !linkedTestCaseId,
                  checked: !linkedTestCaseId,
                }}
                accessibilityLabel="Linked test case: None"
                style={[
                  styles.caseSelectPill,
                  {
                    backgroundColor: !linkedTestCaseId
                      ? theme.primarySoft
                      : theme.surfaceMuted,
                    borderColor: !linkedTestCaseId
                      ? theme.primary
                      : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.caseSelectText,
                    {
                      color: !linkedTestCaseId
                        ? theme.primary
                        : theme.textSecondary,
                    },
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {testCases.map((tc) => {
                const active = linkedTestCaseId === tc.id;
                return (
                  <TouchableOpacity
                    key={tc.id}
                    onPress={() => handleSelectLinkedCaseInForm(tc.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Link test case ${tc.id}`}
                    style={[
                      styles.caseSelectPill,
                      {
                        backgroundColor: active
                          ? theme.primarySoft
                          : theme.surfaceMuted,
                        borderColor: active ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.caseSelectText,
                        {
                          color: active
                            ? theme.primary
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {tc.id}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Linked Test Run
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 4 }}
            >
              <TouchableOpacity
                onPress={() => setLinkedTestRunId('')}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: !linkedTestRunId,
                  checked: !linkedTestRunId,
                }}
                accessibilityLabel="Linked test run: None"
                style={[
                  styles.caseSelectPill,
                  {
                    backgroundColor: !linkedTestRunId
                      ? theme.infoSoft
                      : theme.surfaceMuted,
                    borderColor: !linkedTestRunId ? theme.info : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.caseSelectText,
                    {
                      color: !linkedTestRunId
                        ? theme.info
                        : theme.textSecondary,
                    },
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {testRuns.map((run) => {
                const active = linkedTestRunId === run.id;
                return (
                  <TouchableOpacity
                    key={run.id}
                    onPress={() => setLinkedTestRunId(run.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Link test run ${run.id}: ${run.name}`}
                    style={[
                      styles.caseSelectPill,
                      {
                        backgroundColor: active
                          ? theme.infoSoft
                          : theme.surfaceMuted,
                        borderColor: active ? theme.info : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.caseSelectText,
                        {
                          color: active ? theme.info : theme.textSecondary,
                        },
                      ]}
                    >
                      {run.id} • {run.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Summary / Description
            </Text>
            <TextInput
              ref={defectDescRef}
              style={[
                styles.textArea,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="Brief context or root-cause hypothesis..."
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Summary or Description"
              multiline
              onFocus={() => scrollDefectModalTo(340)}
              value={description}
              onChangeText={setDescription}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Steps to Reproduce *
            </Text>
            <TextInput
              ref={defectReproRef}
              style={[
                styles.textArea,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="1. Open screen...\n2. Tap button..."
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Steps to Reproduce, required"
              multiline
              onFocus={() => scrollDefectModalTo(440)}
              value={reproSteps}
              onChangeText={setReproSteps}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Expected Result
            </Text>
            <TextInput
              ref={defectExpectedRef}
              style={[
                styles.textArea,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="What should happen?"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Expected Result"
              multiline
              onFocus={() => scrollDefectModalTo(540)}
              value={expectedResult}
              onChangeText={setExpectedResult}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Actual Result / Crash Log *
            </Text>
            <TextInput
              ref={defectActualRef}
              style={[
                styles.textArea,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="What actually happened or stacktrace..."
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Actual Result or Crash Log, required"
              multiline
              onFocus={() => scrollDefectModalTo(640)}
              value={actualResult}
              onChangeText={setActualResult}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Device & Build Environment
            </Text>
            <TextInput
              ref={defectEnvRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. Device · OS · Build (optional)"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Device and Build Environment"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollDefectModalTo(740)}
              onSubmitEditing={() => defectUrlRef.current?.focus()}
              value={environment}
              onChangeText={setEnvironment}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              External Issue URL (Optional)
            </Text>
            <TextInput
              ref={defectUrlRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="https://jira.example.com/browse/QAV-102"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="External Issue URL"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onFocus={() => scrollDefectModalTo(810)}
              onSubmitEditing={handleSaveDefect}
              value={externalUrl}
              onChangeText={setExternalUrl}
            />
          </ScrollView>

          <View
            style={[
              styles.modalFooter,
              {
                borderTopColor: theme.border,
                paddingBottom: Math.max(16, insets.bottom + 8),
              },
            ]}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingDefect) }}
              accessibilityLabel="Cancel defect form"
              style={[
                styles.cancelBtn,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setFormModalVisible(false)}
              disabled={isSubmittingDefect}
            >
              <Text
                style={[
                  styles.cancelBtnText,
                  { color: theme.textSecondary },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingDefect) }}
              accessibilityLabel={
                editingDefectId ? 'Save defect changes' : 'Submit defect'
              }
              style={[
                styles.saveBtn,
                {
                  backgroundColor: editingDefectId
                    ? theme.primary
                    : theme.danger,
                  opacity: isSubmittingDefect ? 0.7 : 1,
                },
              ]}
              onPress={handleSaveDefect}
              disabled={isSubmittingDefect}
            >
              {isSubmittingDefect ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <VectorIcon name="check" size={15} color="#FFFFFF" />
              )}
              <Text style={styles.saveBtnText}>
                {editingDefectId ? 'Save Changes' : 'Submit Defect'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

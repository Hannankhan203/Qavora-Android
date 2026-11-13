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
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VectorIcon from '../VectorIcon';
import { monoFontFamily } from '../../theme/theme';
import styles from './testRunsStyles';

export default function TestRunExecutionModal({
  theme,
  executingCase,
  setExecutingCaseId,
  activeRun,
  execRunnerScrollRef,
  execActualResultRef,
  execNotesRef,
  execTesterRef,
  execEnvironmentRef,
  execDeviceRef,
  execBuildVersionRef,
  scrollRunModalTo,
  stepStatuses,
  markAllStepsPassed,
  toggleStepStatus,
  execActualResult,
  setExecActualResult,
  execNotes,
  setExecNotes,
  execTester,
  setExecTester,
  execEnvironment,
  setExecEnvironment,
  execDevice,
  setExecDevice,
  execBuildVersion,
  setExecBuildVersion,
  isSubmittingExec,
  handleSaveExecution,
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={!!executingCase}
      animationType="slide"
      transparent
      onRequestClose={() => !isSubmittingExec && setExecutingCaseId(null)}
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
          {executingCase && (
            <>
              <View
                style={[
                  styles.modalHeader,
                  { borderBottomColor: theme.border },
                ]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text
                    style={[
                      styles.modalCaseId,
                      { color: theme.primary, fontFamily: monoFontFamily },
                    ]}
                  >
                    {executingCase.id} • {activeRun?.id} ({activeRun?.name})
                  </Text>
                  <Text
                    accessibilityRole="header"
                    style={[styles.modalTitle, { color: theme.text }]}
                    numberOfLines={2}
                  >
                    {executingCase.title}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => !isSubmittingExec && setExecutingCaseId(null)}
                  disabled={Boolean(isSubmittingExec)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                  accessibilityLabel="Close execution runner"
                  style={[
                    styles.closeBtn,
                    {
                      backgroundColor: theme.surfaceMuted,
                      opacity: isSubmittingExec ? 0.5 : 1,
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
                ref={execRunnerScrollRef}
                style={styles.modalScrollArea}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalBody}
              >
                {executingCase.preconditions ? (
                  <View
                    style={[
                      styles.precondBanner,
                      {
                        backgroundColor: theme.infoSoft,
                        borderColor: theme.info,
                      },
                    ]}
                  >
                    <VectorIcon name="info" size={14} color={theme.info} />
                    <Text
                      style={[styles.precondText, { color: theme.text }]}
                    >
                      <Text style={{ fontWeight: '800' }}>
                        Precondition:{' '}
                      </Text>
                      {executingCase.preconditions}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.stepSectionHeaderRow}>
                  <Text
                    style={[
                      styles.sectionHeaderLabel,
                      { color: theme.textSecondary, marginBottom: 0 },
                    ]}
                  >
                    INTERACTIVE STEP VERIFICATION (
                    {
                      Object.values(stepStatuses).filter(
                        (s) => s === 'Passed'
                      ).length
                    }
                    /{(executingCase.steps || []).length} PASSED)
                  </Text>
                  {(executingCase.steps || []).length > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.passAllStepsBtn,
                        { backgroundColor: theme.successSoft },
                      ]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel="Pass all steps"
                      onPress={markAllStepsPassed}
                    >
                      <VectorIcon
                        name="check"
                        size={12}
                        color={theme.success}
                      />
                      <Text
                        style={[
                          styles.passAllStepsBtnText,
                          { color: theme.success },
                        ]}
                      >
                        Pass All Steps
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {(executingCase.steps || []).map((step, idx) => {
                  const stepText =
                    typeof step === 'string'
                      ? step
                      : step?.action || step?.step || '';
                  const stepExpected =
                    typeof step === 'object'
                      ? step?.expectedResult || step?.expected || ''
                      : '';
                  const st = stepStatuses[idx] || 'Untested';
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.stepRunnerRow,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor:
                            st === 'Passed'
                              ? theme.success
                              : st === 'Failed'
                              ? theme.danger
                              : theme.border,
                        },
                      ]}
                    >
                      <View style={styles.stepInfo}>
                        <Text
                          style={[
                            styles.stepNumLabel,
                            { color: theme.primary },
                          ]}
                        >
                          Step {idx + 1}
                        </Text>
                        <Text
                          style={[
                            styles.stepDescText,
                            { color: theme.text },
                          ]}
                        >
                          {stepText}
                        </Text>
                        {stepExpected ? (
                          <Text
                            style={[
                              styles.stepExpectedSub,
                              { color: theme.textSecondary },
                            ]}
                          >
                            Expected: {stepExpected}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.stepToggles}>
                        <TouchableOpacity
                          onPress={() => toggleStepStatus(idx, 'Passed')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: st === 'Passed' }}
                          accessibilityLabel={`Mark step ${idx + 1} passed`}
                          style={[
                            styles.stepToggleBtn,
                            {
                              backgroundColor:
                                st === 'Passed'
                                  ? theme.success
                                  : theme.surface,
                              borderColor: theme.success,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="check"
                            size={14}
                            color={
                              st === 'Passed' ? '#FFFFFF' : theme.success
                            }
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => toggleStepStatus(idx, 'Failed')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: st === 'Failed' }}
                          accessibilityLabel={`Mark step ${idx + 1} failed`}
                          style={[
                            styles.stepToggleBtn,
                            {
                              backgroundColor:
                                st === 'Failed'
                                  ? theme.danger
                                  : theme.surface,
                              borderColor: theme.danger,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="close"
                            size={14}
                            color={
                              st === 'Failed' ? '#FFFFFF' : theme.danger
                            }
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                <View
                  style={[
                    styles.expectedBox,
                    {
                      backgroundColor: theme.successSoft,
                      borderColor: theme.success,
                    },
                  ]}
                >
                  <Text
                    style={[styles.expectedLabel, { color: theme.success }]}
                  >
                    EXPECTED OUTCOME
                  </Text>
                  <Text style={[styles.expectedVal, { color: theme.text }]}>
                    {executingCase.expectedResult ||
                      'Verify expected behavior across all steps.'}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.sectionHeaderLabel,
                    { color: theme.textSecondary, marginTop: 14 },
                  ]}
                >
                  ACTUAL RESULT / OBSERVED OUTCOME
                </Text>
                <TextInput
                  ref={execActualResultRef}
                  style={[
                    styles.notesArea,
                    {
                      backgroundColor: theme.surfaceMuted,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  placeholder="Record actual result observed during execution..."
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Actual result or observed outcome"
                  multiline
                  onFocus={() => scrollRunModalTo(execRunnerScrollRef, 240)}
                  value={execActualResult}
                  onChangeText={setExecActualResult}
                />

                <Text
                  style={[
                    styles.sectionHeaderLabel,
                    { color: theme.textSecondary, marginTop: 14 },
                  ]}
                >
                  EXECUTION NOTES & LOGS
                </Text>
                <TextInput
                  ref={execNotesRef}
                  style={[
                    styles.notesArea,
                    {
                      backgroundColor: theme.surfaceMuted,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  placeholder="Add logcat snippets, latency metrics, or environment notes..."
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Execution notes and logs"
                  multiline
                  onFocus={() => scrollRunModalTo(execRunnerScrollRef, 340)}
                  value={execNotes}
                  onChangeText={setExecNotes}
                />

                <View style={styles.execMetaInputsGrid}>
                  <View style={styles.execMetaInputCol}>
                    <Text
                      style={[
                        styles.inputLabel,
                        { color: theme.textSecondary, marginTop: 10 },
                      ]}
                    >
                      Tester
                    </Text>
                    <TextInput
                      ref={execTesterRef}
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={execTester}
                      onChangeText={setExecTester}
                      placeholder="Tester name"
                      placeholderTextColor={theme.textMuted}
                      accessibilityLabel="Execution Tester"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onFocus={() =>
                        scrollRunModalTo(execRunnerScrollRef, 440)
                      }
                      onSubmitEditing={() =>
                        execEnvironmentRef.current?.focus()
                      }
                    />
                  </View>
                  <View style={styles.execMetaInputCol}>
                    <Text
                      style={[
                        styles.inputLabel,
                        { color: theme.textSecondary, marginTop: 10 },
                      ]}
                    >
                      Environment
                    </Text>
                    <TextInput
                      ref={execEnvironmentRef}
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={execEnvironment}
                      onChangeText={setExecEnvironment}
                      placeholder="Android 14 / Staging"
                      placeholderTextColor={theme.textMuted}
                      accessibilityLabel="Execution Environment"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onFocus={() =>
                        scrollRunModalTo(execRunnerScrollRef, 440)
                      }
                      onSubmitEditing={() =>
                        execDeviceRef?.current?.focus()
                      }
                    />
                  </View>
                </View>

                <View style={styles.execMetaInputsGrid}>
                  <View style={styles.execMetaInputCol}>
                    <Text
                      style={[
                        styles.inputLabel,
                        { color: theme.textSecondary, marginTop: 10 },
                      ]}
                    >
                      Device / OS
                    </Text>
                    <TextInput
                      ref={execDeviceRef}
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={execDevice}
                      onChangeText={setExecDevice}
                      placeholder="Pixel 8 Pro • Android 14"
                      placeholderTextColor={theme.textMuted}
                      accessibilityLabel="Execution Device"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onFocus={() =>
                        scrollRunModalTo(execRunnerScrollRef, 510)
                      }
                      onSubmitEditing={() =>
                        execBuildVersionRef?.current?.focus()
                      }
                    />
                  </View>
                  <View style={styles.execMetaInputCol}>
                    <Text
                      style={[
                        styles.inputLabel,
                        { color: theme.textSecondary, marginTop: 10 },
                      ]}
                    >
                      Build Version
                    </Text>
                    <TextInput
                      ref={execBuildVersionRef}
                      style={[
                        styles.inputField,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      value={execBuildVersion}
                      onChangeText={setExecBuildVersion}
                      placeholder="2.4.0-rc3"
                      placeholderTextColor={theme.textMuted}
                      accessibilityLabel="Execution Build Version"
                      returnKeyType="done"
                      onFocus={() =>
                        scrollRunModalTo(execRunnerScrollRef, 510)
                      }
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </View>
                </View>
              </ScrollView>

              <View
                style={[
                  styles.runnerFooter,
                  {
                    borderTopColor: theme.border,
                    paddingBottom: Math.max(12, insets.bottom + 8),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.runnerFooterTitle,
                    { color: theme.textSecondary },
                  ]}
                >
                  RECORD FINAL TEST RESULT:
                </Text>
                <View style={styles.runnerOutcomeButtons}>
                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      { backgroundColor: theme.success },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                    accessibilityLabel="Record final result: Pass"
                    onPress={() => handleSaveExecution('Passed', false)}
                    disabled={isSubmittingExec}
                  >
                    <VectorIcon name="check" size={14} color="#FFFFFF" />
                    <Text style={styles.outcomeBtnText}>Pass</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      { backgroundColor: theme.danger },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                    accessibilityLabel="Record final result: Fail"
                    onPress={() => handleSaveExecution('Failed', false)}
                    disabled={isSubmittingExec}
                  >
                    <VectorIcon name="close" size={14} color="#FFFFFF" />
                    <Text style={styles.outcomeBtnText}>Fail</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      { backgroundColor: theme.warning },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                    accessibilityLabel="Record final result: Blocked"
                    onPress={() => handleSaveExecution('Blocked', false)}
                    disabled={isSubmittingExec}
                  >
                    <VectorIcon name="alert" size={14} color="#FFFFFF" />
                    <Text style={styles.outcomeBtnText}>Blocked</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      {
                        backgroundColor: theme.surfaceMuted,
                        borderWidth: 1,
                        borderColor: theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                    accessibilityLabel="Record final result: Not Run"
                    onPress={() => handleSaveExecution('Untested', false)}
                    disabled={isSubmittingExec}
                  >
                    <VectorIcon
                      name="refresh"
                      size={14}
                      color={theme.textSecondary}
                    />
                    <Text
                      style={[
                        styles.outcomeBtnText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      Not Run
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.failAndBugBtn,
                    {
                      backgroundColor: theme.dangerSoft,
                      borderColor: theme.danger,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isSubmittingExec) }}
                  accessibilityLabel="Mark Failed and Create Linked Defect"
                  onPress={() => handleSaveExecution('Failed', true)}
                  disabled={isSubmittingExec}
                >
                  <VectorIcon name="alert" size={15} color={theme.danger} />
                  <Text
                    style={[
                      styles.failAndBugBtnText,
                      { color: theme.danger },
                    ]}
                  >
                    Mark Failed & Create Linked Defect
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

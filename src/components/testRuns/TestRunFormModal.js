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
import VectorIcon from '../VectorIcon';
import styles from './testRunsStyles';

export default function TestRunFormModal({
  theme,
  runModalVisible,
  setRunModalVisible,
  editingRunId,
  runFormScrollRef,
  runNameRef,
  runEnvironmentRef,
  runDeviceRef,
  runBuildRef,
  runTesterRef,
  runNotesRef,
  scrollRunModalTo,
  runFormError,
  runName,
  setRunName,
  runSuiteId,
  handleChangeRunSuiteScope,
  testCases,
  suites,
  selectedCaseIds,
  setSelectedCaseIds,
  candidateCasesForModal,
  toggleCandidateCaseSelection,
  runEnvironment,
  setRunEnvironment,
  runDevice,
  setRunDevice,
  runBuild,
  setRunBuild,
  runTester,
  setRunTester,
  runNotes,
  setRunNotes,
  isSubmittingRun,
  handleSaveRunModal,
}) {
  return (
    <Modal
      visible={runModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setRunModalVisible(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
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
              {editingRunId
                ? `Edit Test Run (${editingRunId})`
                : 'Create New Test Run'}
            </Text>
            <TouchableOpacity
              onPress={() => setRunModalVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close test run form"
              style={[
                styles.closeBtn,
                { backgroundColor: theme.surfaceMuted },
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
            ref={runFormScrollRef}
            style={styles.modalScrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalBody}
          >
            {runFormError ? (
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
                  {runFormError}
                </Text>
              </View>
            ) : null}

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Run Name *
            </Text>
            <TextInput
              ref={runNameRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., Release v2.4 Smoke Verification"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Run Name, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollRunModalTo(runFormScrollRef, 0)}
              onSubmitEditing={() => runEnvironmentRef.current?.focus()}
              value={runName}
              onChangeText={setRunName}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Target Suite Scope
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 6 }}
            >
              <TouchableOpacity
                onPress={() => handleChangeRunSuiteScope('all')}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: runSuiteId === 'all' || runSuiteId === 'ALL',
                  checked: runSuiteId === 'all' || runSuiteId === 'ALL',
                }}
                accessibilityLabel={`Target suite scope: All Suites (${testCases.length} cases)`}
                style={[
                  styles.optionPill,
                  {
                    backgroundColor:
                      runSuiteId === 'all' || runSuiteId === 'ALL'
                        ? theme.primarySoft
                        : theme.surfaceMuted,
                    borderColor:
                      runSuiteId === 'all' || runSuiteId === 'ALL'
                        ? theme.primary
                        : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionPillText,
                    {
                      color:
                        runSuiteId === 'all' || runSuiteId === 'ALL'
                          ? theme.primary
                          : theme.textSecondary,
                    },
                  ]}
                >
                  All Suites ({testCases.length} cases)
                </Text>
              </TouchableOpacity>
              {suites.map((s) => {
                const active = runSuiteId === s.id;
                const count = testCases.filter(
                  (tc) => tc.suiteId === s.id
                ).length;
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => handleChangeRunSuiteScope(s.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`Target suite scope: ${s.name} (${count} cases)`}
                    style={[
                      styles.optionPill,
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
                        styles.optionPillText,
                        {
                          color: active
                            ? theme.primary
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {s.name} ({count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Applicable Test Cases Selection */}
            <View style={styles.caseSelectionHeader}>
              <Text
                style={[
                  styles.inputLabel,
                  { color: theme.textSecondary, marginTop: 4 },
                ]}
              >
                Select Applicable Test Cases ({selectedCaseIds.length} of{' '}
                {candidateCasesForModal.length} selected)
              </Text>
              <View style={styles.caseSelectionQuickBtns}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Select all candidate test cases"
                  onPress={() =>
                    setSelectedCaseIds(
                      candidateCasesForModal.map((tc) => tc.id)
                    )
                  }
                >
                  <Text
                    style={[styles.selectAllLink, { color: theme.primary }]}
                  >
                    Select All
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: theme.textMuted }}>•</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear selected test cases"
                  onPress={() => setSelectedCaseIds([])}
                >
                  <Text
                    style={[
                      styles.selectAllLink,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Clear
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={true}
              style={[
                styles.casePickerBox,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}
            >
              {candidateCasesForModal.length === 0 ? (
                <Text
                  style={[
                    styles.emptyPickerText,
                    { color: theme.textMuted },
                  ]}
                >
                  No test cases available in this suite scope.
                </Text>
              ) : (
                candidateCasesForModal.map((tc) => {
                  const checked = selectedCaseIds.includes(tc.id);
                  return (
                    <TouchableOpacity
                      key={tc.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={`Include ${tc.id}: ${tc.title}`}
                      style={[
                        styles.casePickerRow,
                        {
                          borderBottomColor: theme.border,
                          backgroundColor: checked
                            ? theme.primarySoft
                            : 'transparent',
                        },
                      ]}
                      onPress={() => toggleCandidateCaseSelection(tc.id)}
                    >
                      <VectorIcon
                        name={checked ? 'check' : 'plus'}
                        size={14}
                        color={checked ? theme.primary : theme.textMuted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.casePickerTitle,
                            { color: theme.text },
                          ]}
                          numberOfLines={1}
                        >
                          <Text
                            style={{
                              color: theme.primary,
                              fontWeight: '800',
                            }}
                          >
                            {tc.id}
                          </Text>{' '}
                          • {tc.title}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Environment
            </Text>
            <TextInput
              ref={runEnvironmentRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., Android 14 / Staging"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Run Environment"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollRunModalTo(runFormScrollRef, 260)}
              onSubmitEditing={() => runDeviceRef.current?.focus()}
              value={runEnvironment}
              onChangeText={setRunEnvironment}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Target Device & Android OS
            </Text>
            <TextInput
              ref={runDeviceRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., Pixel 8 Pro • Android 14"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Target Device and Android OS"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollRunModalTo(runFormScrollRef, 330)}
              onSubmitEditing={() => runBuildRef.current?.focus()}
              value={runDevice}
              onChangeText={setRunDevice}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Build Version
            </Text>
            <TextInput
              ref={runBuildRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., 2.4.0-rc3 (Build 418)"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Build Version"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollRunModalTo(runFormScrollRef, 400)}
              onSubmitEditing={() => runTesterRef.current?.focus()}
              value={runBuild}
              onChangeText={setRunBuild}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Assigned Tester
            </Text>
            <TextInput
              ref={runTesterRef}
              style={[
                styles.inputField,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              placeholder="e.g., QA Lead"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Assigned Tester"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollRunModalTo(runFormScrollRef, 470)}
              onSubmitEditing={() => runNotesRef.current?.focus()}
              value={runTester}
              onChangeText={setRunTester}
            />

            <Text
              style={[styles.inputLabel, { color: theme.textSecondary }]}
            >
              Run Notes / Cycle Scope
            </Text>
            <TextInput
              ref={runNotesRef}
              style={[
                styles.notesArea,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                  color: theme.text,
                  marginTop: 6,
                },
              ]}
              placeholder="Optional cycle notes or release criteria..."
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Run Notes or Cycle Scope"
              multiline
              onFocus={() => scrollRunModalTo(runFormScrollRef, 550)}
              value={runNotes}
              onChangeText={setRunNotes}
            />
          </ScrollView>

          <View
            style={[
              styles.modalFooter,
              { borderTopColor: theme.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.cancelBtn,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingRun) }}
              accessibilityLabel="Cancel test run form"
              onPress={() => setRunModalVisible(false)}
              disabled={isSubmittingRun}
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
              style={[
                styles.saveBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: isSubmittingRun ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingRun) }}
              accessibilityLabel={
                editingRunId ? 'Save Run Changes' : 'Launch Test Run'
              }
              onPress={handleSaveRunModal}
              disabled={isSubmittingRun}
            >
              {isSubmittingRun ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <VectorIcon name="check" size={15} color="#FFFFFF" />
              )}
              <Text style={styles.saveBtnText}>
                {editingRunId ? 'Save Run Changes' : 'Launch Test Run'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

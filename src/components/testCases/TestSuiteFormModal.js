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
import styles from './testCasesStyles';

export default function TestSuiteFormModal({
  isSuiteModalOpen,
  setIsSuiteModalOpen,
  isSubmittingSuite,
  editingSuite,
  suiteFormScrollRef,
  suiteFormError,
  suiteNameRef,
  suiteNameInput,
  setSuiteNameInput,
  scrollModalTo,
  suiteTagsRef,
  suiteCategories,
  suiteCategoryInput,
  setSuiteCategoryInput,
  planPhases,
  suitePhaseIdInput,
  setSuitePhaseIdInput,
  suiteTagsInput,
  setSuiteTagsInput,
  suiteDescRef,
  suiteDescInput,
  setSuiteDescInput,
  handleSaveSuite,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={isSuiteModalOpen}
      animationType="fade"
      transparent
      onRequestClose={() => !isSubmittingSuite && setIsSuiteModalOpen(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.centeredModalOverlay,
          { backgroundColor: colors.overlay },
        ]}
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
            accessibilityRole="header"
            style={[styles.smallModalTitle, { color: colors.text }]}
          >
            {editingSuite ? 'Edit Test Suite' : 'Create Test Suite'}
          </Text>

          <ScrollView
            ref={suiteFormScrollRef}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 10 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
              ref={suiteNameRef}
              value={suiteNameInput}
              onChangeText={setSuiteNameInput}
              placeholder="e.g., Payment & Checkout Flows"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Suite Name, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollModalTo(suiteFormScrollRef, 0)}
              onSubmitEditing={() => suiteTagsRef.current?.focus()}
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
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      accessibilityLabel={`Suite category: ${cat}`}
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
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: !suitePhaseIdInput,
                      checked: !suitePhaseIdInput,
                    }}
                    accessibilityLabel="Testing phase: General (Unassigned)"
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
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: active,
                          checked: active,
                        }}
                        accessibilityLabel={`Testing phase: ${ph.name}`}
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
              ref={suiteTagsRef}
              value={suiteTagsInput}
              onChangeText={setSuiteTagsInput}
              placeholder="e.g., checkout, stripe, critical"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Suite Tags, comma-separated"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollModalTo(suiteFormScrollRef, 140)}
              onSubmitEditing={() => suiteDescRef.current?.focus()}
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
              ref={suiteDescRef}
              value={suiteDescInput}
              onChangeText={setSuiteDescInput}
              placeholder="Scope of this test suite..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Suite Description"
              returnKeyType="done"
              onFocus={() => scrollModalTo(suiteFormScrollRef, 220)}
              onSubmitEditing={handleSaveSuite}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />
          </ScrollView>

          <View style={styles.smallModalActions}>
            <Pressable
              disabled={isSubmittingSuite}
              onPress={() => setIsSuiteModalOpen(false)}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingSuite) }}
              accessibilityLabel="Cancel test suite form"
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
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingSuite) }}
              accessibilityLabel={
                editingSuite ? 'Save Suite' : 'Create Suite'
              }
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
  );
}

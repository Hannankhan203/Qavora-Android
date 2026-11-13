import React from 'react';
import {
  Text,
  View,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/theme';
import styles from './testCasesStyles';

export default function TestPhaseFormModal({
  isPhaseModalOpen,
  setIsPhaseModalOpen,
  isSubmittingPhase,
  editingPhase,
  phaseFormError,
  phaseNameRef,
  phaseNameInput,
  setPhaseNameInput,
  phaseDescRef,
  phaseDescInput,
  setPhaseDescInput,
  handleSavePhase,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={isPhaseModalOpen}
      animationType="fade"
      transparent
      onRequestClose={() => !isSubmittingPhase && setIsPhaseModalOpen(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.centeredModalOverlay,
          {
            backgroundColor: colors.overlay,
            paddingTop: Math.max(20, insets.top),
            paddingBottom: Math.max(20, insets.bottom + 8),
          },
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
            ref={phaseNameRef}
            value={phaseNameInput}
            onChangeText={setPhaseNameInput}
            placeholder="e.g., Phase 1: Smoke & Sanity"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Phase Name, required"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => phaseDescRef.current?.focus()}
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
            ref={phaseDescRef}
            value={phaseDescInput}
            onChangeText={setPhaseDescInput}
            placeholder="Goals and gate criteria for this phase..."
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Phase Description"
            returnKeyType="done"
            onSubmitEditing={handleSavePhase}
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
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingPhase) }}
              accessibilityLabel="Cancel phase form"
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
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingPhase) }}
              accessibilityLabel={editingPhase ? 'Save Phase' : 'Add Phase'}
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
  );
}

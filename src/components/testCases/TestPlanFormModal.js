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

const TEST_PLAN_FIELDS = [
  {
    key: 'description',
    label: 'Plan Overview & Description',
    placeholder: 'High-level summary of the release test plan...',
  },
  {
    key: 'objective',
    label: 'Testing Objectives',
    placeholder: 'Primary quality goals and validation targets...',
  },
  {
    key: 'scope',
    label: 'In Scope',
    placeholder: 'Features, modules, and APIs covered by this plan...',
  },
  {
    key: 'outOfScope',
    label: 'Out of Scope',
    placeholder: 'Features explicitly excluded from this cycle...',
  },
  {
    key: 'strategy',
    label: 'Test Strategy & Approach',
    placeholder: 'Manual, automated, exploratory, regression strategy...',
  },
  {
    key: 'environment',
    label: 'Test Environment & Infrastructure',
    placeholder: 'Target devices, OS versions, staging endpoints...',
  },
  {
    key: 'entryCriteria',
    label: 'Entry Criteria',
    placeholder: 'Conditions required before testing starts...',
  },
  {
    key: 'exitCriteria',
    label: 'Exit Criteria',
    placeholder: 'Pass rate and defect thresholds for sign-off...',
  },
  {
    key: 'deliverables',
    label: 'QA Deliverables',
    placeholder: 'Test reports, defect logs, release sign-off...',
  },
  {
    key: 'risks',
    label: 'Risks & Mitigation',
    placeholder: 'Known technical or schedule risks and fallbacks...',
  },
  {
    key: 'tools',
    label: 'Tools & Automation Stack',
    placeholder: 'Qavora, Playwright, Postman, Android Studio...',
  },
  {
    key: 'schedule',
    label: 'Schedule & Milestones',
    placeholder: 'Target dates for freeze, regression, and release...',
  },
  {
    key: 'approvals',
    label: 'Sign-off & Approvals',
    placeholder: 'QA Lead, Product Manager, Engineering Lead...',
  },
  {
    key: 'notes',
    label: 'Additional Notes',
    placeholder: 'Any supplemental test plan notes...',
  },
];

export default function TestPlanFormModal({
  isPlanModalOpen,
  setIsPlanModalOpen,
  isSubmittingPlan,
  planFormScrollRef,
  planFormError,
  planForm,
  handlePlanFieldChange,
  scrollModalTo,
  handleSavePlan,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={isPlanModalOpen}
      animationType="slide"
      transparent
      onRequestClose={() => !isSubmittingPlan && setIsPlanModalOpen(false)}
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
              Edit Project Test Plan
            </Text>
            <Pressable
              onPress={() => !isSubmittingPlan && setIsPlanModalOpen(false)}
              disabled={Boolean(isSubmittingPlan)}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingPlan) }}
              accessibilityLabel="Close test plan editor"
              style={[
                styles.closeCircle,
                {
                  backgroundColor: colors.surfaceMuted,
                  opacity: isSubmittingPlan ? 0.5 : 1,
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
            ref={planFormScrollRef}
            style={styles.modalBody}
            contentContainerStyle={styles.modalBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {planFormError && (
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
                  {planFormError}
                </Text>
              </View>
            )}

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Test Plan Name *
            </Text>
            <TextInput
              value={planForm.name}
              onChangeText={(val) => handlePlanFieldChange('name', val)}
              placeholder="e.g., Qavora v2.4 Master Test Plan"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Test Plan Name, required"
              returnKeyType="next"
              onFocus={() => scrollModalTo(planFormScrollRef, 0)}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            {TEST_PLAN_FIELDS.map((field, idx) => (
              <View key={field.key}>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
                  {field.label}
                </Text>
                <TextInput
                  value={planForm[field.key]}
                  onChangeText={(val) =>
                    handlePlanFieldChange(field.key, val)
                  }
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={field.label}
                  multiline
                  onFocus={() =>
                    scrollModalTo(planFormScrollRef, 60 + idx * 105)
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
              </View>
            ))}
          </ScrollView>

          <View
            style={[styles.modalFooter, { borderTopColor: colors.border }]}
          >
            <Pressable
              disabled={isSubmittingPlan}
              onPress={() => setIsPlanModalOpen(false)}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingPlan) }}
              accessibilityLabel="Cancel editing test plan"
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
              disabled={isSubmittingPlan}
              onPress={handleSavePlan}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isSubmittingPlan) }}
              accessibilityLabel="Save Test Plan"
              style={[
                styles.footerPrimaryBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              {isSubmittingPlan ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.footerPrimaryText}>Save Test Plan</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

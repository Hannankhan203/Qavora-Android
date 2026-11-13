import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, monoFontFamily } from '../../theme/theme';
import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_PRIORITIES,
  CHECKLIST_STARTER_TEMPLATES,
} from '../../services/checklistService';
import styles from './checklistsStyles';

export default function ChecklistFormModal({
  formModalVisible,
  setFormModalVisible,
  formMode,
  checklistFormScrollRef,
  formError,
  formTemplateId,
  handleSelectStarterTemplate,
  formTitleRef,
  formTitle,
  setFormTitle,
  scrollChecklistFormTo,
  formDescRef,
  formDescription,
  setFormDescription,
  formCategory,
  setFormCategory,
  formPriority,
  setFormPriority,
  selectedProjectId,
  selectedProject,
  formProjectScope,
  setFormProjectScope,
  formEnvRef,
  formEnvironment,
  setFormEnvironment,
  formReleaseRef,
  formTargetRelease,
  setFormTargetRelease,
  formCustomItemsRef,
  formCustomItemsText,
  setFormCustomItemsText,
  handleSaveChecklistForm,
  busyMutation,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={formModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => !busyMutation && setFormModalVisible(false)}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
      >
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.modalTitle, { color: colors.text }]}
          >
            {formMode === 'create'
              ? 'Create QA Checklist'
              : 'Edit QA Checklist'}
          </Text>

          <ScrollView
            ref={checklistFormScrollRef}
            style={styles.modalScrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {formError ? (
              <View
                style={[
                  styles.errorAlert,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.errorAlertText, { color: colors.danger }]}>
                  {formError}
                </Text>
              </View>
            ) : null}

            {formMode === 'create' ? (
              <View style={{ marginBottom: 12 }}>
                <Text
                  style={[styles.fieldLabel, { color: colors.textSecondary }]}
                >
                  Starter Template (Optional)
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalPillsRow}
                >
                  <Pressable
                    onPress={() => handleSelectStarterTemplate('none')}
                    disabled={Boolean(busyMutation)}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: formTemplateId === 'none',
                      checked: formTemplateId === 'none',
                      disabled: Boolean(busyMutation),
                    }}
                    accessibilityLabel="Starter template: Blank Custom"
                    style={[
                      styles.filterPill,
                      {
                        backgroundColor:
                          formTemplateId === 'none'
                            ? colors.primary
                            : colors.background,
                        borderColor:
                          formTemplateId === 'none'
                            ? colors.primary
                            : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        {
                          color:
                            formTemplateId === 'none'
                              ? colors.textOnPrimary
                              : colors.textSecondary,
                        },
                      ]}
                    >
                      Blank Custom
                    </Text>
                  </Pressable>
                  {CHECKLIST_STARTER_TEMPLATES.map((tpl) => {
                    const active = formTemplateId === tpl.id;
                    return (
                      <Pressable
                        key={tpl.id}
                        onPress={() => handleSelectStarterTemplate(tpl.id)}
                        disabled={Boolean(busyMutation)}
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: active,
                          checked: active,
                          disabled: Boolean(busyMutation),
                        }}
                        accessibilityLabel={`Starter template: ${tpl.name} (${tpl.items.length} steps)`}
                        style={[
                          styles.filterPill,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.background,
                            borderColor: active
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterPillText,
                            {
                              color: active
                                ? colors.textOnPrimary
                                : colors.textSecondary,
                            },
                          ]}
                        >
                          {tpl.name} ({tpl.items.length})
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Checklist Title *
            </Text>
            <TextInput
              ref={formTitleRef}
              value={formTitle}
              onChangeText={setFormTitle}
              editable={!busyMutation}
              placeholder="e.g., Android v2.4 Release Readiness Checklist"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Checklist Title, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={() => scrollChecklistFormTo(0)}
              onSubmitEditing={() => formDescRef.current?.focus()}
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
              Description
            </Text>
            <TextInput
              ref={formDescRef}
              value={formDescription}
              onChangeText={setFormDescription}
              editable={!busyMutation}
              placeholder="Describe the verification scope and sign-off criteria..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Checklist Description"
              multiline
              onFocus={() => scrollChecklistFormTo(80)}
              style={[
                styles.input,
                {
                  minHeight: 64,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                  textAlignVertical: 'top',
                  paddingTop: 10,
                },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Category
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalPillsRow,
                { marginBottom: 12 },
              ]}
            >
              {CHECKLIST_CATEGORIES.map((cat) => {
                const active = formCategory === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setFormCategory(cat)}
                    disabled={Boolean(busyMutation)}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: active,
                      checked: active,
                      disabled: Boolean(busyMutation),
                    }}
                    accessibilityLabel={`Checklist category: ${cat}`}
                    style={[
                      styles.filterPill,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        {
                          color: active
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Priority
            </Text>
            <View
              accessibilityRole="radiogroup"
              style={[styles.priorityPillsRow, { marginBottom: 12 }]}
            >
              {CHECKLIST_PRIORITIES.map((prio) => {
                const active = formPriority === prio;
                return (
                  <Pressable
                    key={prio}
                    onPress={() => setFormPriority(prio)}
                    disabled={Boolean(busyMutation)}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: active,
                      checked: active,
                      disabled: Boolean(busyMutation),
                    }}
                    accessibilityLabel={`Checklist priority: ${prio}`}
                    style={[
                      styles.miniPill,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniPillText,
                        {
                          color: active
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {prio}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Project Association Selector */}
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Project Association
            </Text>
            <View
              accessibilityRole="radiogroup"
              style={[styles.priorityPillsRow, { marginBottom: 12 }]}
            >
              {selectedProjectId ? (
                <Pressable
                  onPress={() => setFormProjectScope('current')}
                  disabled={Boolean(busyMutation)}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: formProjectScope === 'current',
                    checked: formProjectScope === 'current',
                    disabled: Boolean(busyMutation),
                  }}
                  accessibilityLabel={`Associate with project ${
                    selectedProject?.name || selectedProjectId
                  }`}
                  style={[
                    styles.miniPill,
                    {
                      backgroundColor:
                        formProjectScope === 'current'
                          ? colors.primary
                          : colors.background,
                      borderColor:
                        formProjectScope === 'current'
                          ? colors.primary
                          : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.miniPillText,
                      {
                        color:
                          formProjectScope === 'current'
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    Project: {selectedProject?.name || selectedProjectId}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setFormProjectScope('workspace')}
                disabled={Boolean(busyMutation)}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: formProjectScope === 'workspace',
                  checked: formProjectScope === 'workspace',
                  disabled: Boolean(busyMutation),
                }}
                accessibilityLabel="Workspace-Wide (Standalone) scope"
                style={[
                  styles.miniPill,
                  {
                    backgroundColor:
                      formProjectScope === 'workspace'
                        ? colors.primary
                        : colors.background,
                    borderColor:
                      formProjectScope === 'workspace'
                        ? colors.primary
                        : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.miniPillText,
                    {
                      color:
                        formProjectScope === 'workspace'
                          ? colors.textOnPrimary
                          : colors.textSecondary,
                    },
                  ]}
                >
                  Workspace-Wide (Standalone)
                </Text>
              </Pressable>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.colHalf}>
                <Text
                  style={[styles.fieldLabel, { color: colors.textSecondary }]}
                >
                  Environment
                </Text>
                <TextInput
                  ref={formEnvRef}
                  value={formEnvironment}
                  onChangeText={setFormEnvironment}
                  editable={!busyMutation}
                  placeholder="Staging"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Checklist Environment"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onFocus={() => scrollChecklistFormTo(260)}
                  onSubmitEditing={() => formReleaseRef.current?.focus()}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />
              </View>

              <View style={styles.colHalf}>
                <Text
                  style={[styles.fieldLabel, { color: colors.textSecondary }]}
                >
                  Target Release
                </Text>
                <TextInput
                  ref={formReleaseRef}
                  value={formTargetRelease}
                  onChangeText={setFormTargetRelease}
                  editable={!busyMutation}
                  placeholder="v1.0.0"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Checklist Target Release"
                  returnKeyType={formMode === 'create' ? 'next' : 'done'}
                  blurOnSubmit={formMode !== 'create'}
                  onFocus={() => scrollChecklistFormTo(260)}
                  onSubmitEditing={() => {
                    if (formMode === 'create') {
                      formCustomItemsRef.current?.focus();
                    } else {
                      handleSaveChecklistForm();
                    }
                  }}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                />
              </View>
            </View>

            {formMode === 'create' ? (
              <>
                <Text
                  style={[styles.fieldLabel, { color: colors.textSecondary }]}
                >
                  Initial Checklist Items (One per line, optional)
                </Text>
                <TextInput
                  ref={formCustomItemsRef}
                  value={formCustomItemsText}
                  onChangeText={setFormCustomItemsText}
                  editable={!busyMutation}
                  placeholder={
                    'Verify login session cookie persistence\nValidate CSRF header on mutations\nConfirm dark mode contrast'
                  }
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Initial Checklist Items, one per line"
                  multiline
                  onFocus={() => scrollChecklistFormTo(360)}
                  style={[
                    styles.input,
                    {
                      minHeight: 80,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      textAlignVertical: 'top',
                      paddingTop: 10,
                    },
                  ]}
                />
              </>
            ) : null}
          </ScrollView>

          <View
            style={[
              styles.modalActionsRow,
              { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
            ]}
          >
            <Pressable
              onPress={() => !busyMutation && setFormModalVisible(false)}
              disabled={busyMutation}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyMutation) }}
              accessibilityLabel="Cancel checklist form"
              style={[
                styles.modalCancelBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Text style={[styles.modalCancelText, { color: colors.text }]}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSaveChecklistForm}
              disabled={busyMutation}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyMutation) }}
              accessibilityLabel={
                formMode === 'create' ? 'Create Checklist' : 'Save Changes'
              }
              style={[
                styles.modalConfirmBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: busyMutation ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.modalConfirmText,
                  { color: colors.textOnPrimary },
                ]}
              >
                {busyMutation
                  ? 'Saving...'
                  : formMode === 'create'
                  ? 'Create Checklist'
                  : 'Save Changes'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

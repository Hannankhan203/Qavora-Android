/**
 * Qavora Android — Create & Edit Project Modal (Phase 2B)
 *
 * Implements project creation (`POST /api/projects`) and metadata editing
 * (`PATCH /api/projects/:id` with `expectedUpdatedAt` optimistic concurrency)
 * using the existing `projectService.js` and `ProjectContext.js`.
 *
 * Enforces:
 * - Client-side required field validation (`name`, `type`, `status`)
 * - Backend validation and HTTP 409 conflict error display
 * - Synchronous + state lock preventing duplicate submissions
 * - Loading and success/error feedback
 */

import React, { useState, useEffect, useRef } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useProjects } from '../context/ProjectContext';
import VectorIcon from './VectorIcon';

const PROJECT_TYPE_PRESETS = [
  'Mobile Application',
  'Web Application',
  'API / Microservice',
  'Desktop Application',
];

export default function ProjectFormModal({
  visible = false,
  initialProject = null,
  onClose,
  onSuccess,
}) {
  const { colors } = useTheme();
  const {
    createProject,
    updateProject,
    getProject,
    projectStatuses,
    isMutating,
    conflictState,
    clearProjectError,
  } = useProjects();

  const isEditMode = Boolean(initialProject && (initialProject.id || initialProject._id));

  const [name, setName] = useState('');
  const [type, setType] = useState('Mobile Application');
  const [status, setStatus] = useState('Active');
  const [version, setVersion] = useState('');
  const [environment, setEnvironment] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [localError, setLocalError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submittingLockRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      submittingLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    clearProjectError();
    setLocalError(null);

    if (initialProject) {
      setName(initialProject.name || '');
      setType(initialProject.type || 'Mobile Application');
      setStatus(
        projectStatuses.includes(initialProject.status)
          ? initialProject.status
          : 'Active'
      );
      setVersion(initialProject.version || '');
      setEnvironment(initialProject.environment || '');
      setBaseUrl(initialProject.baseUrl || '');
      setDescription(initialProject.description || '');
      setTagsInput(
        Array.isArray(initialProject.tags) ? initialProject.tags.join(', ') : ''
      );
    } else {
      setName('');
      setType('Mobile Application');
      setStatus('Active');
      setVersion('v1.0.0');
      setEnvironment('Staging');
      setBaseUrl('');
      setDescription('');
      setTagsInput('');
    }
  }, [visible, initialProject, projectStatuses, clearProjectError]);

  const busy = isSubmitting || isMutating;

  const handleClose = () => {
    if (busy) return;
    setLocalError(null);
    clearProjectError();
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const handleReloadConflictProject = async () => {
    if (!isEditMode || !initialProject) return;
    const projectId = initialProject.id || initialProject._id;
    const refreshed = await getProject(projectId);
    if (refreshed && refreshed.ok && refreshed.project) {
      const latest = refreshed.project;
      setName(latest.name || '');
      setType(latest.type || 'Mobile Application');
      setStatus(latest.status || 'Active');
      setVersion(latest.version || '');
      setEnvironment(latest.environment || '');
      setBaseUrl(latest.baseUrl || '');
      setDescription(latest.description || '');
      setTagsInput(Array.isArray(latest.tags) ? latest.tags.join(', ') : '');
      setLocalError(null);
      clearProjectError();
    }
  };

  const handleSubmit = async () => {
    // Prevent duplicate submissions
    if (submittingLockRef.current || busy) {
      return;
    }

    setLocalError(null);
    clearProjectError();

    const trimmedName = name.trim();
    const trimmedType = type.trim() || 'Mobile Application';

    if (!trimmedName) {
      setLocalError('Project name is required and cannot be empty.');
      return;
    }

    if (trimmedName.length > 120) {
      setLocalError('Project name must be 120 characters or fewer.');
      return;
    }

    if (!projectStatuses.includes(status)) {
      setLocalError("Status must be 'Active', 'Completed', or 'Archived'.");
      return;
    }

    const parsedTags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload = {
      name: trimmedName,
      type: trimmedType,
      status,
      version: version.trim(),
      environment: environment.trim(),
      baseUrl: baseUrl.trim(),
      description: description.trim(),
      tags: parsedTags,
    };

    submittingLockRef.current = true;
    setIsSubmitting(true);

    try {
      let result;
      if (isEditMode && initialProject) {
        const targetId = initialProject.id || initialProject._id;
        result = await updateProject(targetId, payload, {
          expectedUpdatedAt: initialProject.updatedAt || undefined,
        });
      } else {
        result = await createProject(payload, { selectCreated: true });
      }

      if (result && result.ok && result.project) {
        if (typeof onSuccess === 'function') {
          onSuccess(result.project, isEditMode ? 'edit' : 'create');
        }
        if (typeof onClose === 'function') {
          onClose();
        }
        return;
      }

      setLocalError(
        (result && result.error) ||
          (isEditMode
            ? 'Failed to update project.'
            : 'Failed to create project.')
      );
    } finally {
      submittingLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.overlay, { backgroundColor: colors.overlay }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {/* Header */}
          <View
            style={[styles.headerRow, { borderBottomColor: colors.border }]}
          >
            <View style={styles.headerTitleWrap}>
              <View
                style={[
                  styles.headerIconBadge,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <VectorIcon
                  name={isEditMode ? 'edit' : 'plus'}
                  size={16}
                  color={colors.primary}
                />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  {isEditMode ? 'Edit Project' : 'Create New Project'}
                </Text>
                <Text
                  style={[
                    styles.headerSub,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  {isEditMode
                    ? `PATCH /api/projects/${initialProject.id || initialProject._id}`
                    : 'POST /api/projects'}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleClose}
              disabled={busy}
              style={[
                styles.closeBtn,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <VectorIcon name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Error & Conflict Feedback */}
            {localError ? (
              <View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <View style={styles.errorHeaderRow}>
                  <VectorIcon name="alert" size={16} color={colors.danger} />
                  <Text style={[styles.errorText, { color: colors.danger }]}>
                    {localError}
                  </Text>
                </View>

                {conflictState && conflictState.isConflict && isEditMode ? (
                  <Pressable
                    onPress={handleReloadConflictProject}
                    style={[
                      styles.conflictReloadBtn,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.danger,
                      },
                    ]}
                  >
                    <VectorIcon name="refresh" size={14} color={colors.danger} />
                    <Text
                      style={[
                        styles.conflictReloadText,
                        { color: colors.danger },
                      ]}
                    >
                      Reload Latest Server Version
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Project Name (Required) */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Project Name <Text style={{ color: colors.danger }}>*</Text>
            </Text>
            <TextInput
              value={name}
              onChangeText={(val) => {
                setName(val);
                if (localError) setLocalError(null);
              }}
              editable={!busy}
              placeholder="e.g. Qavora Android Checkout Regression"
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

            {/* Project Status */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Lifecycle Status
            </Text>
            <View style={styles.chipRow}>
              {projectStatuses.map((statusOption) => {
                const selected = status === statusOption;
                return (
                  <Pressable
                    key={statusOption}
                    disabled={busy}
                    onPress={() => setStatus(statusOption)}
                    style={[
                      styles.choiceChip,
                      {
                        backgroundColor: selected
                          ? colors.primary
                          : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceChipText,
                        {
                          color: selected ? colors.textOnPrimary : colors.text,
                        },
                      ]}
                    >
                      {statusOption}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Project Type */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Application Type
            </Text>
            <View style={styles.chipRow}>
              {PROJECT_TYPE_PRESETS.map((preset) => {
                const selected = type === preset;
                return (
                  <Pressable
                    key={preset}
                    disabled={busy}
                    onPress={() => setType(preset)}
                    style={[
                      styles.typePresetChip,
                      {
                        backgroundColor: selected
                          ? colors.primarySoft
                          : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.typePresetText,
                        {
                          color: selected
                            ? colors.primary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {preset}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={type}
              onChangeText={setType}
              editable={!busy}
              placeholder="Custom project type (e.g. Mobile Application)"
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

            {/* Version & Environment */}
            <View style={styles.twoColRow}>
              <View style={styles.colHalf}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Target Version
                </Text>
                <TextInput
                  value={version}
                  onChangeText={setVersion}
                  editable={!busy}
                  placeholder="v1.0.0"
                  placeholderTextColor={colors.textMuted}
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

              <View style={styles.colHalf}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Environment
                </Text>
                <TextInput
                  value={environment}
                  onChangeText={setEnvironment}
                  editable={!busy}
                  placeholder="Staging / Production"
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
              </View>
            </View>

            {/* Base URL */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Target Base URL (Optional)
            </Text>
            <TextInput
              value={baseUrl}
              onChangeText={setBaseUrl}
              editable={!busy}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://staging.example.com"
              placeholderTextColor={colors.textMuted}
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

            {/* Description */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Project Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              editable={!busy}
              multiline
              numberOfLines={3}
              placeholder="Describe the QA scope, release goals, and target platforms..."
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

            {/* Tags */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Tags (comma-separated)
            </Text>
            <TextInput
              value={tagsInput}
              onChangeText={setTagsInput}
              editable={!busy}
              autoCapitalize="none"
              placeholder="android, regression, checkout"
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
          </ScrollView>

          {/* Footer Actions */}
          <View
            style={[styles.footerRow, { borderTopColor: colors.border }]}
          >
            <Pressable
              onPress={handleClose}
              disabled={busy}
              style={[
                styles.cancelBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Text style={[styles.cancelBtnText, { color: colors.text }]}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSubmit}
              disabled={busy}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: busy
                    ? colors.primaryPressed
                    : colors.primary,
                },
              ]}
            >
              {busy ? (
                <View style={styles.submitBusyRow}>
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                  <Text
                    style={[
                      styles.submitBtnText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    {isEditMode ? 'Saving...' : 'Creating...'}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    styles.submitBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  {isEditMode ? 'Save Changes' : 'Create Project'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 11,
    marginTop: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formScroll: {
    maxHeight: 500,
  },
  formContent: {
    padding: 16,
    paddingBottom: 24,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  conflictReloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  conflictReloadText: {
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
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
    marginBottom: 14,
  },
  textArea: {
    minHeight: 84,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  choiceChip: {
    flex: 1,
    minWidth: 88,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  choiceChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  typePresetChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typePresetText: {
    fontSize: 12,
    fontWeight: '600',
  },
  twoColRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colHalf: {
    flex: 1,
    minWidth: 140,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

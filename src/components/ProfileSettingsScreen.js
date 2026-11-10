import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import DataManagementSection from './DataManagementSection';

export default function ProfileSettingsScreen() {
  const { colors, themePreference, setThemePreference } = useTheme();
  const {
    user,
    logout,
    refreshCurrentUser,
    isLoading: isAuthBusy,
  } = useAuth();
  const { selectedProject, projects } = useProjects();
  const {
    profile,
    suites,
    testCases,
    testRuns,
    executions,
    defects,
    metrics,
    lastPersistedAt,
    openProjectSelection,
    openProjectDetails,
    openReportsView,
    openChecklistsView,
    updateProfile,
    isSavingProfile,
    getSampleRestorePreview,
    resetToSampleData,
    isRestoringSampleData,
    clearAllWorkspaceData,
    isClearingWorkspaceData,
    showToast,
  } = useWorkspace();

  const [testerName, setTesterName] = useState(profile.testerName || '');
  const [role, setRole] = useState(profile.role || '');
  const [projectName, setProjectName] = useState(
    (selectedProject && selectedProject.name) || profile.projectName || ''
  );
  const [targetVersion, setTargetVersion] = useState(
    (selectedProject && selectedProject.version) || profile.targetVersion || ''
  );
  const [defaultDevice, setDefaultDevice] = useState(profile.defaultDevice || '');
  const [defaultBuild, setDefaultBuild] = useState(profile.defaultBuild || '');
  const [verifyingSession, setVerifyingSession] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState(null);
  const [confirmDatasetAction, setConfirmDatasetAction] = useState(null); // 'restore_sample' | 'clear_all' | null

  useEffect(() => {
    setTesterName(profile.testerName || '');
    setRole(profile.role || '');
    setProjectName(
      (selectedProject && selectedProject.name) || profile.projectName || ''
    );
    setTargetVersion(
      (selectedProject && selectedProject.version) || profile.targetVersion || ''
    );
    setDefaultDevice(profile.defaultDevice || '');
    setDefaultBuild(profile.defaultBuild || '');
  }, [
    profile,
    selectedProject && selectedProject.id,
    selectedProject && selectedProject.name,
    selectedProject && selectedProject.version,
    selectedProject && selectedProject.updatedAt,
  ]);

  const handleSaveSettings = async () => {
    if (isSavingProfile) return;
    setProfileFeedback(null);

    const res = await updateProfile({
      testerName: testerName.trim() || 'QA Engineer',
      role: role.trim() || 'QA Analyst',
      projectName: projectName.trim(),
      targetVersion: targetVersion.trim() || 'v1.0.0',
      defaultDevice: defaultDevice.trim() || 'Android Device',
      defaultBuild: defaultBuild.trim() || '1.0.0',
    });

    if (res && res.profile) {
      setProjectName(res.profile.projectName || '');
      setTargetVersion(res.profile.targetVersion || '');
    }

    if (res && res.ok) {
      setProfileFeedback({
        tone: res.queuedOffline ? 'warning' : 'success',
        message: res.queuedOffline
          ? 'Saved locally and queued active project metadata update for offline sync.'
          : res.persistedToBackend
          ? `Active project "${res.profile.projectName}" and local defaults saved.`
          : 'Local tester profile and device defaults saved.',
      });
    } else if (res) {
      setProfileFeedback({
        tone: 'danger',
        message:
          res.error || 'Failed to save profile and active project settings.',
      });
    }
  };

  const handleOpenRestoreSampleModal = () => {
    if (isRestoringSampleData || isClearingWorkspaceData) return;
    setConfirmDatasetAction('restore_sample');
  };

  const handleOpenClearDataModal = () => {
    if (isRestoringSampleData || isClearingWorkspaceData) return;
    setConfirmDatasetAction('clear_all');
  };

  const handleConfirmDatasetAction = async () => {
    if (!confirmDatasetAction) return;
    if (isRestoringSampleData || isClearingWorkspaceData) return;

    if (confirmDatasetAction === 'restore_sample') {
      const res = await resetToSampleData({ confirmed: true });
      if (res && (res.ok || !res.skipped)) {
        setConfirmDatasetAction(null);
      }
      return;
    }

    if (confirmDatasetAction === 'clear_all') {
      const res = await clearAllWorkspaceData({ confirmed: true });
      if (res && (res.ok || !res.skipped)) {
        setConfirmDatasetAction(null);
      }
    }
  };

  const restorePreview = getSampleRestorePreview
    ? getSampleRestorePreview()
    : {
        projectName:
          (selectedProject && selectedProject.name) ||
          profile.projectName ||
          'Active Project',
        willOverwriteBackend: Boolean(selectedProject),
        currentCounts: {
          suites: Array.isArray(suites) ? suites.length : 0,
          testCases: Array.isArray(testCases) ? testCases.length : 0,
          testRuns: Array.isArray(testRuns) ? testRuns.length : 0,
          executions: Array.isArray(executions) ? executions.length : 0,
          defects: Array.isArray(defects) ? defects.length : 0,
        },
        sampleCounts: {
          suites: 4,
          testCases: 10,
          testRuns: 2,
          executions: 0,
          defects: 4,
        },
      };

  const handleVerifySession = async () => {
    setVerifyingSession(true);
    try {
      const res = await refreshCurrentUser();
      if (res && res.ok && showToast) {
        showToast(`Session verified for ${res.user.email}`, 'success');
      }
    } finally {
      setVerifyingSession(false);
    }
  };

  const displayUserName = (user && user.name) || profile.testerName;
  const displayUserRole = (user && user.role) || profile.role;
  const activeProjectTitle =
    (selectedProject && selectedProject.name) || profile.projectName;

  const initials = (
    (user && user.avatarInitials) ||
    displayUserName ||
    'QA'
  )
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Authenticated Cloud Session & QA Summary Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.profileRow}>
            <View style={[styles.avatarBox, { backgroundColor: colors.primary }]}>
              <Text style={[styles.avatarText, { color: colors.textOnPrimary }]}>
                {initials || 'QA'}
              </Text>
            </View>
            <View style={styles.profileTextCol}>
              <Text style={[styles.profileName, { color: colors.text }]}>
                {displayUserName}
              </Text>
              <Text
                style={[
                  styles.profileRole,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                {displayUserRole} · {activeProjectTitle}
                {profile.targetVersion ? ` (${profile.targetVersion})` : ''}
              </Text>
              {user ? (
                <Text
                  style={[
                    styles.storageModeText,
                    { color: colors.success, fontFamily: monoFontFamily },
                  ]}
                >
                  Authenticated: {user.email} · {projects.length}{' '}
                  {projects.length === 1 ? 'project' : 'projects'}
                </Text>
              ) : (
                <Text style={[styles.storageModeText, { color: colors.textMuted }]}>
                  Storage: Local Device AsyncStorage
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.dataButtonsRow, { marginBottom: 12 }]}>
            <Pressable
              onPress={openChecklistsView}
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: colors.surfaceAccent,
                  borderColor: colors.primary,
                  flexDirection: 'row',
                  gap: 6,
                },
              ]}
            >
              <VectorIcon name="clipboard" size={15} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                QA Checklists
              </Text>
            </Pressable>

            {selectedProject ? (
              <Pressable
                onPress={openReportsView}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.primary,
                    flexDirection: 'row',
                    gap: 6,
                  },
                ]}
              >
                <VectorIcon name="file-text" size={15} color={colors.primary} />
                <Text
                  style={[styles.secondaryBtnText, { color: colors.primary }]}
                >
                  Reports & Export
                </Text>
              </Pressable>
            ) : null}

            {selectedProject ? (
              <Pressable
                onPress={openProjectDetails}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                    flexDirection: 'row',
                    gap: 6,
                  },
                ]}
              >
                <VectorIcon name="info" size={15} color={colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                  Project Details
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={openProjectSelection}
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                  flexDirection: 'row',
                  gap: 6,
                },
              ]}
            >
              <VectorIcon name="switch" size={15} color={colors.text} />
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                {selectedProject ? 'Switch Project' : 'Select Project'} (
                {projects.length})
              </Text>
            </Pressable>
          </View>

          {user ? (
            <View
              style={[
                styles.dataButtonsRow,
                { marginBottom: 12 },
              ]}
            >
              <Pressable
                onPress={handleVerifySession}
                disabled={verifyingSession || isAuthBusy}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                  {verifyingSession
                    ? 'Verifying...'
                    : 'Verify Session (/api/auth/me)'}
                </Text>
              </Pressable>

              <Pressable
                onPress={logout}
                disabled={isAuthBusy}
                style={[
                  styles.dangerBtn,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.dangerBtnText, { color: colors.danger }]}>
                  {isAuthBusy ? 'Signing out...' : 'Sign Out'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <View style={styles.statCell}>
              <Text
                style={[
                  styles.statVal,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                {metrics.totalTestCases}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                Test Cases
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text
                style={[
                  styles.statVal,
                  { color: colors.success, fontFamily: monoFontFamily },
                ]}
              >
                {metrics.passRate}%
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                Pass Rate
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text
                style={[
                  styles.statVal,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                {metrics.totalRuns}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                Test Runs
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text
                style={[
                  styles.statVal,
                  {
                    color: metrics.openDefects > 0 ? colors.danger : colors.success,
                    fontFamily: monoFontFamily,
                  },
                ]}
              >
                {metrics.openDefects}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                Open Defects
              </Text>
            </View>
          </View>
        </View>

        {/* Phase 2F: Data Management, Backup, Restore & Offline Synchronization */}
        <DataManagementSection />

        {/* Adaptive Theme Toggle */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionKicker,
              { color: colors.primary, fontFamily: monoFontFamily },
            ]}
          >
            APPEARANCE & THEME
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Interface Color Mode
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Persisted locally in AsyncStorage across Android and Web sessions.
          </Text>

          <View style={styles.themeButtonsRow}>
            {[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
              { id: 'system', label: 'System' },
            ].map((mode) => {
              const active = themePreference === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => setThemePreference(mode.id)}
                  style={[
                    styles.themeBtn,
                    {
                      backgroundColor: active ? colors.primary : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.themeBtnText,
                      { color: active ? colors.textOnPrimary : colors.text },
                    ]}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* QA Tester & Default Project Defaults */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionKicker,
              { color: colors.primary, fontFamily: monoFontFamily },
            ]}
          >
            QA WORKSPACE & DEVICE DEFAULTS
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Local Profile & Default Environment
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Used to pre-fill new Test Runs and Defect reports on this device.
          </Text>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            QA Tester Name
          </Text>
          <TextInput
            value={testerName}
            onChangeText={setTesterName}
            placeholder="QA Engineer"
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

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            QA Role / Title
          </Text>
          <TextInput
            value={role}
            onChangeText={setRole}
            placeholder="Lead QA Analyst"
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

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            {selectedProject
              ? 'Active Project Name (Persisted to Server)'
              : 'Default Project Name'}
          </Text>
          <TextInput
            value={projectName}
            onChangeText={(val) => {
              setProjectName(val);
              if (profileFeedback) setProfileFeedback(null);
            }}
            placeholder="Enter project name"
            placeholderTextColor={colors.textMuted}
            maxLength={120}
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          />

          <View style={styles.twoColRow}>
            <View style={styles.colHalf}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Target Release Version
              </Text>
              <TextInput
                value={targetVersion}
                onChangeText={setTargetVersion}
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
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Default Build Number
              </Text>
              <TextInput
                value={defaultBuild}
                onChangeText={setDefaultBuild}
                placeholder="1.0.0-build.104"
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
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Default Test Device / Android Version
          </Text>
          <TextInput
            value={defaultDevice}
            onChangeText={setDefaultDevice}
            placeholder="Android 15 · Pixel 8 (360dp)"
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

          {profileFeedback ? (
            <View
              style={[
                styles.feedbackBanner,
                {
                  backgroundColor:
                    profileFeedback.tone === 'danger'
                      ? colors.dangerSoft
                      : profileFeedback.tone === 'warning'
                      ? colors.warningSoft
                      : colors.successSoft,
                  borderColor:
                    profileFeedback.tone === 'danger'
                      ? colors.danger
                      : profileFeedback.tone === 'warning'
                      ? colors.warning
                      : colors.success,
                },
              ]}
            >
              <Text
                style={[
                  styles.feedbackBannerText,
                  {
                    color:
                      profileFeedback.tone === 'danger'
                        ? colors.danger
                        : profileFeedback.tone === 'warning'
                        ? colors.warning
                        : colors.success,
                  },
                ]}
              >
                {profileFeedback.message}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleSaveSettings}
            disabled={isSavingProfile}
            style={[
              styles.saveBtn,
              {
                backgroundColor: colors.primary,
                opacity: isSavingProfile ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.saveBtnText, { color: colors.textOnPrimary }]}>
              {isSavingProfile
                ? 'Saving Profile & Project...'
                : 'Save Profile & Project Settings'}
            </Text>
          </Pressable>
        </View>

        {/* Local & Active Project Dataset Reset Controls */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionKicker,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            PROJECT DATASET & RESET CONTROLS
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Sample QA Dataset & Project Reset
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Restoring the sample QA dataset or clearing project data will replace all test suites, test cases, test runs, executions, and defects for the active project ({activeProjectTitle}). Explicit confirmation is required.
            {lastPersistedAt ? ` Last saved: ${lastPersistedAt}.` : ''}
          </Text>

          <View style={styles.dataButtonsRow}>
            <Pressable
              onPress={handleOpenRestoreSampleModal}
              disabled={isRestoringSampleData || isClearingWorkspaceData}
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                  opacity:
                    isRestoringSampleData || isClearingWorkspaceData ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                {isRestoringSampleData
                  ? 'Restoring Sample Dataset...'
                  : 'Restore Sample QA Dataset'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleOpenClearDataModal}
              disabled={isRestoringSampleData || isClearingWorkspaceData}
              style={[
                styles.dangerBtn,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                  opacity:
                    isRestoringSampleData || isClearingWorkspaceData ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.dangerBtnText, { color: colors.danger }]}>
                {isClearingWorkspaceData
                  ? 'Clearing Data...'
                  : 'Clear All Local Data'}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Explicit Confirmation Modal for Sample Dataset Restoration & Clear All Data */}
      <Modal
        visible={Boolean(confirmDatasetAction)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isRestoringSampleData && !isClearingWorkspaceData) {
            setConfirmDatasetAction(null);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <VectorIcon
                name="alert-triangle"
                size={20}
                color={
                  confirmDatasetAction === 'clear_all'
                    ? colors.danger
                    : colors.warning
                }
              />
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {confirmDatasetAction === 'restore_sample'
                  ? 'Confirm Sample QA Dataset Restore'
                  : 'Confirm Clear Project QA Data'}
              </Text>
            </View>

            <Text
              style={[styles.modalDescription, { color: colors.textSecondary }]}
            >
              {confirmDatasetAction === 'restore_sample'
                ? `You are about to overwrite the active project "${restorePreview.projectName}" with the Qavora Sample QA Dataset. Existing suites, test cases, test runs, execution logs, and defects in this project will be replaced on the backend and local cache.`
                : `You are about to permanently clear all test suites, test cases, test runs, execution logs, and defects from the active project "${restorePreview.projectName}".`}
            </Text>

            <View
              style={[
                styles.previewBox,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.previewBoxTitle,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                DATA REPLACEMENT SUMMARY ({restorePreview.projectName})
              </Text>
              <Text
                style={[
                  styles.previewLine,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                • Test Suites: {restorePreview.currentCounts.suites} current →{' '}
                {confirmDatasetAction === 'restore_sample'
                  ? `${restorePreview.sampleCounts.suites} sample suites`
                  : '1 empty default suite'}
              </Text>
              <Text
                style={[
                  styles.previewLine,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                • Test Cases: {restorePreview.currentCounts.testCases} current →{' '}
                {confirmDatasetAction === 'restore_sample'
                  ? `${restorePreview.sampleCounts.testCases} sample cases`
                  : '0 cases'}
              </Text>
              <Text
                style={[
                  styles.previewLine,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                • Test Runs: {restorePreview.currentCounts.testRuns} current →{' '}
                {confirmDatasetAction === 'restore_sample'
                  ? `${restorePreview.sampleCounts.testRuns} sample runs`
                  : '0 runs'}
              </Text>
              <Text
                style={[
                  styles.previewLine,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                • Executions: {restorePreview.currentCounts.executions} current
                → 0 execution logs
              </Text>
              <Text
                style={[
                  styles.previewLine,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                • Defects: {restorePreview.currentCounts.defects} current →{' '}
                {confirmDatasetAction === 'restore_sample'
                  ? `${restorePreview.sampleCounts.defects} sample defects`
                  : '0 defects'}
              </Text>
            </View>

            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setConfirmDatasetAction(null)}
                disabled={isRestoringSampleData || isClearingWorkspaceData}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleConfirmDatasetAction}
                disabled={isRestoringSampleData || isClearingWorkspaceData}
                style={[
                  styles.dangerBtn,
                  {
                    backgroundColor:
                      confirmDatasetAction === 'restore_sample'
                        ? colors.primary
                        : colors.danger,
                    borderColor:
                      confirmDatasetAction === 'restore_sample'
                        ? colors.primary
                        : colors.danger,
                    flexDirection: 'row',
                    gap: 8,
                    opacity:
                      isRestoringSampleData || isClearingWorkspaceData
                        ? 0.7
                        : 1,
                  },
                ]}
              >
                {isRestoringSampleData || isClearingWorkspaceData ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : null}
                <Text style={[styles.dangerBtnText, { color: '#FFFFFF' }]}>
                  {confirmDatasetAction === 'restore_sample'
                    ? isRestoringSampleData
                      ? 'Restoring...'
                      : 'Confirm & Overwrite Project Data'
                    : isClearingWorkspaceData
                    ? 'Clearing...'
                    : 'Confirm & Clear Project Data'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 96,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  profileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  avatarBox: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  profileTextCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 160,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  profileRole: {
    fontSize: 12,
    marginBottom: 2,
  },
  storageModeText: {
    fontSize: 11,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  statCell: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
  },
  statVal: {
    fontSize: 17,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  themeButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeBtn: {
    flex: 1,
    minWidth: 82,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  themeBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  fieldLabel: {
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
    marginBottom: 12,
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
  saveBtn: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dataButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  dangerBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dangerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  feedbackBanner: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  feedbackBannerText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    flexShrink: 1,
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 5,
  },
  previewBoxTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewLine: {
    fontSize: 12,
    lineHeight: 17,
  },
  modalActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
});

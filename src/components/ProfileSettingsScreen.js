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
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';

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
    metrics,
    openProjectSelection,
    openProjectDetails,
    openDataManagementView,
    updateProfile,
    isSavingProfile,
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
  const [defaultDevice, setDefaultDevice] = useState(
    profile.defaultDevice || ''
  );
  const [defaultBuild, setDefaultBuild] = useState(profile.defaultBuild || '');
  const [verifyingSession, setVerifyingSession] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState(null);

  useEffect(() => {
    setTesterName(profile.testerName || '');
    setRole(profile.role || '');
    setProjectName(
      (selectedProject && selectedProject.name) || profile.projectName || ''
    );
    setTargetVersion(
      (selectedProject && selectedProject.version) ||
        profile.targetVersion ||
        ''
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
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Profile & Authenticated Account Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.profileRow}>
            <View
              style={[styles.avatarBox, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[styles.avatarText, { color: colors.textOnPrimary }]}
              >
                {initials || 'QA'}
              </Text>
            </View>
            <View style={styles.profileTextCol}>
              <Text
                numberOfLines={1}
                style={[styles.profileName, { color: colors.text }]}
              >
                {displayUserName}
              </Text>
              <Text
                numberOfLines={1}
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
                  numberOfLines={1}
                  style={[
                    styles.storageModeText,
                    { color: colors.success, fontFamily: monoFontFamily },
                  ]}
                >
                  {user.email} · {projects.length}{' '}
                  {projects.length === 1 ? 'project' : 'projects'}
                </Text>
              ) : (
                <Text
                  style={[styles.storageModeText, { color: colors.textMuted }]}
                >
                  Storage: Local Device AsyncStorage
                </Text>
              )}
            </View>
          </View>

          {selectedProject ? (
            <View
              style={[styles.statsRow, { borderTopColor: colors.border }]}
            >
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
                  Cases
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
                  Runs
                </Text>
              </View>
              <View style={styles.statCell}>
                <Text
                  style={[
                    styles.statVal,
                    {
                      color:
                        metrics.openDefects > 0
                          ? colors.danger
                          : colors.success,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                >
                  {metrics.openDefects}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                  Defects
                </Text>
              </View>
            </View>
          ) : null}

          <View style={[styles.actionGridRow, { marginTop: 10 }]}>
            <Pressable
              onPress={openProjectSelection}
              style={[
                styles.compactActionBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <VectorIcon name="folder" size={14} color={colors.primary} />
              <Text
                numberOfLines={1}
                style={[styles.compactActionBtnText, { color: colors.text }]}
              >
                {selectedProject ? 'Switch Project' : 'Select Project'} (
                {projects.length})
              </Text>
            </Pressable>

            {selectedProject ? (
              <Pressable
                onPress={openProjectDetails}
                style={[
                  styles.compactActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <VectorIcon name="info" size={14} color={colors.primary} />
                <Text
                  numberOfLines={1}
                  style={[styles.compactActionBtnText, { color: colors.text }]}
                >
                  Project Details
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={openDataManagementView}
              style={[
                styles.compactActionBtn,
                {
                  backgroundColor: colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <VectorIcon name="refresh" size={14} color={colors.primary} />
              <Text
                numberOfLines={1}
                style={[styles.compactActionBtnText, { color: colors.primary }]}
              >
                Data Management →
              </Text>
            </Pressable>
          </View>

          {user ? (
            <View style={[styles.actionGridRow, { marginTop: 8 }]}>
              <Pressable
                onPress={handleVerifySession}
                disabled={verifyingSession || isAuthBusy}
                style={[
                  styles.compactActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.compactActionBtnText, { color: colors.text }]}
                >
                  {verifyingSession ? 'Verifying...' : 'Verify Session'}
                </Text>
              </Pressable>

              <Pressable
                onPress={logout}
                disabled={isAuthBusy}
                style={[
                  styles.compactDangerBtn,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.compactDangerBtnText, { color: colors.danger }]}
                >
                  {isAuthBusy ? 'Signing out...' : 'Sign Out'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* 2. Appearance & Theme Preferences */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.compactHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.sectionKicker,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                APPEARANCE & PREFERENCES
              </Text>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Interface Color Mode
              </Text>
            </View>
          </View>

          <View style={styles.themeButtonsRow}>
            {[
              { id: 'light', label: 'Light', icon: 'sun' },
              { id: 'dark', label: 'Dark', icon: 'moon' },
              { id: 'system', label: 'System', icon: 'globe' },
            ].map((mode) => {
              const active = themePreference === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => setThemePreference(mode.id)}
                  style={[
                    styles.themeBtn,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <VectorIcon
                    name={mode.icon}
                    size={14}
                    color={active ? colors.textOnPrimary : colors.textSecondary}
                  />
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

        {/* 3. Application & QA Workspace Defaults */}
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
            APPLICATION & QA WORKSPACE SETTINGS
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Profile & Default Environment
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Pre-fills new Test Runs and Defect reports on this device.
          </Text>

          <View style={styles.twoColRow}>
            <View style={styles.colHalf}>
              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
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
            </View>

            <View style={styles.colHalf}>
              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
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
            </View>
          </View>

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
              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
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
              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
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
                ? 'Saving Profile & Settings...'
                : 'Save Profile & Settings'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  avatarBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  profileTextCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 1,
  },
  profileRole: {
    fontSize: 11.5,
    marginBottom: 1,
  },
  storageModeText: {
    fontSize: 10.5,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 9,
    gap: 6,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 10,
    marginTop: 1,
  },
  actionGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactActionBtn: {
    flex: 1,
    minWidth: 98,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    gap: 5,
  },
  compactActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  compactDangerBtn: {
    flex: 1,
    minWidth: 98,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  compactDangerBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionKicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    marginBottom: 10,
  },
  themeButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
  },
  themeBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    fontSize: 13.5,
    marginBottom: 9,
  },
  twoColRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colHalf: {
    flex: 1,
    minWidth: 138,
  },
  saveBtn: {
    minHeight: 42,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  saveBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  feedbackBanner: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 9,
  },
  feedbackBannerText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});

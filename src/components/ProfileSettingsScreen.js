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
    metrics,
    lastPersistedAt,
    openProjectSelection,
    openProjectDetails,
    openReportsView,
    updateProfile,
    resetToSampleData,
    clearAllWorkspaceData,
    showToast,
  } = useWorkspace();

  const [testerName, setTesterName] = useState(profile.testerName || '');
  const [role, setRole] = useState(profile.role || '');
  const [projectName, setProjectName] = useState(profile.projectName || '');
  const [targetVersion, setTargetVersion] = useState(profile.targetVersion || '');
  const [defaultDevice, setDefaultDevice] = useState(profile.defaultDevice || '');
  const [defaultBuild, setDefaultBuild] = useState(profile.defaultBuild || '');
  const [verifyingSession, setVerifyingSession] = useState(false);

  useEffect(() => {
    setTesterName(profile.testerName || '');
    setRole(profile.role || '');
    setProjectName(profile.projectName || '');
    setTargetVersion(profile.targetVersion || '');
    setDefaultDevice(profile.defaultDevice || '');
    setDefaultBuild(profile.defaultBuild || '');
  }, [profile]);

  const handleSaveSettings = () => {
    updateProfile({
      testerName: testerName.trim() || 'QA Engineer',
      role: role.trim() || 'QA Analyst',
      projectName: projectName.trim() || 'Qavora Mobile App',
      targetVersion: targetVersion.trim() || 'v1.0.0',
      defaultDevice: defaultDevice.trim() || 'Android Device',
      defaultBuild: defaultBuild.trim() || '1.0.0',
    });
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
                {displayUserRole} · {activeProjectTitle} ({profile.targetVersion})
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
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                Reports & Export
              </Text>
            </Pressable>

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
                Switch Project ({projects.length})
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
            Project Name
          </Text>
          <TextInput
            value={projectName}
            onChangeText={setProjectName}
            placeholder="Qavora Mobile App"
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

          <Pressable
            onPress={handleSaveSettings}
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.saveBtnText, { color: colors.textOnPrimary }]}>
              Save Profile & Project Settings
            </Text>
          </Pressable>
        </View>

        {/* Local AsyncStorage Persistence Management */}
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
            LOCAL ASYNCSTORAGE DATA MANAGEMENT
          </Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Local Dataset Controls
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            All QA suites, test cases, test runs, and defects are stored locally on your device via @react-native-async-storage/async-storage.
            {lastPersistedAt ? ` Last saved: ${lastPersistedAt}.` : ''}
          </Text>

          <View style={styles.dataButtonsRow}>
            <Pressable
              onPress={resetToSampleData}
              style={[
                styles.secondaryBtn,
                { backgroundColor: colors.background, borderColor: colors.borderStrong },
              ]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                Restore Sample QA Dataset
              </Text>
            </Pressable>

            <Pressable
              onPress={clearAllWorkspaceData}
              style={[
                styles.dangerBtn,
                { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
              ]}
            >
              <Text style={[styles.dangerBtnText, { color: colors.danger }]}>
                Clear All Local Data
              </Text>
            </Pressable>
          </View>
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
    minWidth: 68,
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
    gap: 8,
  },
  themeBtn: {
    flex: 1,
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
});

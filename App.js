import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, monoFontFamily } from './src/theme/theme';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ProjectProvider, useProjects } from './src/context/ProjectContext';
import { WorkspaceProvider, useWorkspace } from './src/context/WorkspaceContext';
import AuthScreen from './src/components/AuthScreen';
import ProjectSelectionScreen from './src/components/ProjectSelectionScreen';
import ProjectDetailsScreen from './src/components/ProjectDetailsScreen';
import DashboardScreen from './src/components/DashboardScreen';
import TestCasesScreen from './src/components/TestCasesScreen';
import TestRunsScreen from './src/components/TestRunsScreen';
import DefectsScreen from './src/components/DefectsScreen';
import ProfileSettingsScreen from './src/components/ProfileSettingsScreen';
import VectorIcon from './src/components/VectorIcon';
import { startConnectivityMonitoring } from './src/services/offlineSyncService';

const BOTTOM_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'testcases', label: 'Test Cases' },
  { id: 'testruns', label: 'Test Runs' },
  { id: 'defects', label: 'Defects' },
  { id: 'profile', label: 'Profile' },
];

const SCREEN_TITLES = {
  dashboard: 'QA Overview',
  testcases: 'Test Cases',
  testruns: 'Test Runs',
  defects: 'Defects',
  profile: 'Profile & Settings',
};

function QavoraQAShell() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { selectedProject, syncStatus, isOffline } = useProjects();
  const {
    activeTab,
    setActiveTab,
    dashboardSubTab,
    setDashboardSubTab,
    projectViewMode,
    setProjectViewMode,
    metrics,
    selectedTestCaseId,
    setSelectedTestCaseId,
    selectedDefectId,
    setSelectedDefectId,
    toast,
    dismissToast,
  } = useWorkspace();

  // If no project is selected, always show the Project Selection screen
  const effectiveViewMode = !selectedProject ? 'selection' : projectViewMode;

  // Android Hardware Back Navigation Handler
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (effectiveViewMode === 'details' && selectedProject) {
        setProjectViewMode('workspace');
        return true;
      }
      if (effectiveViewMode === 'selection' && selectedProject) {
        setProjectViewMode('workspace');
        return true;
      }
      if (selectedTestCaseId) {
        setSelectedTestCaseId(null);
        return true;
      }
      if (selectedDefectId) {
        setSelectedDefectId(null);
        return true;
      }
      if (activeTab === 'dashboard' && dashboardSubTab === 'reports') {
        setDashboardSubTab('overview');
        return true;
      }
      if (activeTab !== 'dashboard') {
        setActiveTab('dashboard');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [
    effectiveViewMode,
    selectedProject,
    activeTab,
    dashboardSubTab,
    selectedTestCaseId,
    selectedDefectId,
    setProjectViewMode,
    setActiveTab,
    setDashboardSubTab,
    setSelectedTestCaseId,
    setSelectedDefectId,
  ]);

  const headerSubtitle = !selectedProject
    ? 'Select or Create a Project'
    : effectiveViewMode === 'selection'
    ? `Switching Project · Active: ${selectedProject.name}`
    : effectiveViewMode === 'details'
    ? `${selectedProject.name} · Project Details`
    : activeTab === 'dashboard' && dashboardSubTab === 'reports'
    ? `${selectedProject.name} · Reports & Analytics`
    : `${selectedProject.name} · ${SCREEN_TITLES[activeTab] || 'QA Manager'}`;

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.safeRoot, { backgroundColor: colors.background }]}
    >
      <StatusBar style={colors.statusBar} />

      {/* Contextual Mobile Top Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.topBarInner}>
          <Pressable
            onPress={() => {
              if (selectedProject) {
                setProjectViewMode(
                  effectiveViewMode === 'details' ? 'workspace' : 'details'
                );
              }
            }}
            style={styles.brandLockup}
          >
            <View style={[styles.brandBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.brandBadgeText, { color: colors.textOnPrimary }]}>
                Q
              </Text>
            </View>
            <View style={styles.brandTextWrap}>
              <Text
                numberOfLines={1}
                style={[styles.brandTitle, { color: colors.text }]}
              >
                {selectedProject ? selectedProject.name : 'Qavora'}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.screenSubtitle,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                {headerSubtitle}
              </Text>
            </View>
          </Pressable>

          <View style={styles.topRightUtilities}>
            {selectedProject ? (
              <Pressable
                onPress={() =>
                  setProjectViewMode(
                    effectiveViewMode === 'selection' ? 'workspace' : 'selection'
                  )
                }
                style={[
                  styles.projectSwitchBtn,
                  {
                    backgroundColor:
                      effectiveViewMode === 'selection'
                        ? colors.primary
                        : colors.surfaceAccent,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <VectorIcon
                  name="folder"
                  size={14}
                  color={
                    effectiveViewMode === 'selection'
                      ? colors.textOnPrimary
                      : colors.primary
                  }
                />
                <Text
                  style={[
                    styles.projectSwitchBtnText,
                    {
                      color:
                        effectiveViewMode === 'selection'
                          ? colors.textOnPrimary
                          : colors.primary,
                    },
                  ]}
                >
                  Projects
                </Text>
              </Pressable>
            ) : null}

            {selectedProject && effectiveViewMode === 'workspace' ? (
              <Text
                style={[
                  styles.passRatePill,
                  { color: colors.success, fontFamily: monoFontFamily },
                ]}
              >
                {metrics.passRate}% Pass
              </Text>
            ) : null}

            {(isOffline ||
              (syncStatus &&
                (syncStatus.totalQueued > 0 ||
                  syncStatus.conflictCount > 0 ||
                  syncStatus.isSyncing))) ? (
              <Pressable
                onPress={() => {
                  setProjectViewMode('workspace');
                  setActiveTab('profile');
                }}
                style={[
                  styles.syncPillBtn,
                  {
                    backgroundColor:
                      syncStatus && syncStatus.conflictCount > 0
                        ? colors.dangerSoft
                        : isOffline
                        ? colors.surfaceAccent
                        : colors.surfaceAccent,
                    borderColor:
                      syncStatus && syncStatus.conflictCount > 0
                        ? colors.danger
                        : isOffline
                        ? colors.warning
                        : colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.syncPillText,
                    {
                      color:
                        syncStatus && syncStatus.conflictCount > 0
                          ? colors.danger
                          : isOffline
                          ? colors.warning
                          : colors.primary,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                >
                  {syncStatus && syncStatus.conflictCount > 0
                    ? `Conflict (${syncStatus.conflictCount})`
                    : isOffline
                    ? `Offline${
                        syncStatus && syncStatus.pendingCount > 0
                          ? ` (${syncStatus.pendingCount})`
                          : ''
                      }`
                    : syncStatus && syncStatus.isSyncing
                    ? 'Syncing...'
                    : `Sync (${syncStatus.pendingCount})`}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={toggleTheme}
              style={[
                styles.themeBtn,
                {
                  backgroundColor: colors.surfaceAccent,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Text style={[styles.themeBtnText, { color: colors.primary }]}>
                {isDark ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Non-Blocking Feedback Toast */}
      {toast ? (
        <Pressable
          onPress={dismissToast}
          style={[
            styles.toastBanner,
            {
              backgroundColor: colors.surfaceElevated,
              borderBottomColor:
                toast.tone === 'danger'
                  ? colors.danger
                  : toast.tone === 'success'
                  ? colors.success
                  : colors.primary,
            },
          ]}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.toastText,
              { color: colors.text, fontFamily: monoFontFamily },
            ]}
          >
            {toast.message}
          </Text>
          <Text style={[styles.toastClose, { color: colors.textMuted }]}>OK</Text>
        </Pressable>
      ) : null}

      {/* Active Viewport */}
      <View style={styles.mainViewport}>
        {effectiveViewMode === 'selection' ? (
          <ProjectSelectionScreen
            onOpenWorkspace={
              selectedProject ? () => setProjectViewMode('workspace') : () => setProjectViewMode('workspace')
            }
            onOpenProjectDetails={() => setProjectViewMode('details')}
          />
        ) : effectiveViewMode === 'details' ? (
          <ProjectDetailsScreen
            onBackToWorkspace={() => setProjectViewMode('workspace')}
            onSwitchProject={() => setProjectViewMode('selection')}
            onProjectDeleted={() => setProjectViewMode('selection')}
          />
        ) : (
          <>
            {activeTab === 'dashboard' && <DashboardScreen />}
            {activeTab === 'testcases' && <TestCasesScreen />}
            {activeTab === 'testruns' && <TestRunsScreen />}
            {activeTab === 'defects' && <DefectsScreen />}
            {activeTab === 'profile' && <ProfileSettingsScreen />}
          </>
        )}
      </View>

      {/* Single Primary Bottom Navigation Bar (Shown when a project is selected) */}
      {selectedProject ? (
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <View style={styles.bottomBarInner}>
            {BOTTOM_TABS.map((tab) => {
              const active =
                effectiveViewMode === 'workspace' && activeTab === tab.id;
              const showOpenBugCount =
                tab.id === 'defects' && metrics.openDefects > 0;

              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    setProjectViewMode('workspace');
                    setActiveTab(tab.id);
                  }}
                  style={styles.bottomTabBtn}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.bottomTabLabel,
                      {
                        color: active ? colors.primary : colors.textSecondary,
                        fontWeight: active ? '700' : '500',
                      },
                    ]}
                  >
                    {tab.label}
                    {showOpenBugCount ? ` (${metrics.openDefects})` : ''}
                  </Text>
                  {active && (
                    <View
                      style={[
                        styles.activeBarIndicator,
                        { backgroundColor: colors.primary },
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function AuthRootGate() {
  const { colors } = useTheme();
  const { isAuthenticated, isRestoringSession } = useAuth();

  if (isRestoringSession) {
    return (
      <SafeAreaView
        edges={['top', 'bottom', 'left', 'right']}
        style={[
          styles.restoringContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <StatusBar style={colors.statusBar} />
        <View
          style={[
            styles.restoringCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.restoringTitle, { color: colors.text }]}>
            Restoring Qavora Session
          </Text>
          <Text
            style={[
              styles.restoringSubtitle,
              { color: colors.textMuted, fontFamily: monoFontFamily },
            ]}
          >
            Verifying authenticated session via /api/auth/me...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <ProjectProvider>
      <WorkspaceProvider>
        <QavoraQAShell />
      </WorkspaceProvider>
    </ProjectProvider>
  );
}

export default function App() {
  useEffect(() => {
    const stopMonitoring = startConnectivityMonitoring();
    return () => {
      stopMonitoring();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AuthRootGate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeRoot: {
    flex: 1,
  },
  restoringContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  restoringCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    gap: 10,
  },
  restoringTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  restoringSubtitle: {
    fontSize: 12,
    textAlign: 'center',
  },
  topBar: {
    height: 54,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  topBarInner: {
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    flexShrink: 1,
  },
  brandBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeText: {
    fontSize: 16,
    fontWeight: '700',
  },
  brandTextWrap: {
    flex: 1,
    flexShrink: 1,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 11,
  },
  topRightUtilities: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectSwitchBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  projectSwitchBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  passRatePill: {
    fontSize: 12,
    fontWeight: '700',
  },
  syncPillBtn: {
    minHeight: 34,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  themeBtn: {
    minHeight: 36,
    minWidth: 52,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 2,
    gap: 10,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  toastClose: {
    fontSize: 12,
    fontWeight: '700',
  },
  mainViewport: {
    flex: 1,
  },
  bottomBar: {
    height: 58,
    borderTopWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bottomBarInner: {
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomTabBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    position: 'relative',
  },
  bottomTabLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  activeBarIndicator: {
    position: 'absolute',
    bottom: 4,
    width: 22,
    height: 3,
    borderRadius: 2,
  },
});

/**
 * Qavora Android — Data Management, Backup, Restore & Offline Sync UI (Phase 2F)
 *
 * Provides mobile-optimized controls for:
 * 1. Offline & Synchronization Center (online/offline status, simulated offline
 *    toggle, pending/syncing/conflict/failed counters, manual Sync Now, queue
 *    inspection, and HTTP 409 conflict resolution)
 * 2. Database & Local Storage Usage (`GET /api/data/storage-usage` + AsyncStorage stats)
 * 3. Project & Workspace Export (`Project JSON`, `Full Backup JSON`, `Test Cases CSV`,
 *    `Executions CSV`, `Defects CSV`) with interactive preview & share modal
 * 4. Backup Import & Restore (`parseAndValidateImportPayload` + `POST /api/data/import`
 *    supporting Safe Merge and Destructive Replace with Import Preview modal)
 * 5. Server Recovery Snapshot (`GET /api/data/recovery-snapshot`, `POST /api/data/rollback`,
 *    `DELETE /api/data/recovery-snapshot`) & Local Point-in-Time Snapshots
 * 6. Workspace Reset Danger Zone (`POST /api/data/reset`) with Backup-First safeguard
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme.js';
import { useAuth } from '../context/AuthContext.js';
import { useProjects } from '../context/ProjectContext.js';
import { useWorkspace } from '../context/WorkspaceContext.js';
import {
  exportProjectAsJSON,
  exportFullBackup,
  exportTestCasesCSV,
  exportExecutionsCSV,
  exportDefectsCSV,
  createFullBackupPayload,
  parseAndValidateImportPayload,
  fetchStorageUsage,
  fetchRecoverySnapshot,
  clearRecoverySnapshot,
  executeRollback,
  importWorkspaceData,
  resetWorkspaceData,
  getLocalRecoverySnapshots,
  createLocalRecoverySnapshot,
  restoreLocalRecoverySnapshot,
  deleteLocalRecoverySnapshot,
} from '../services/dataManagementService.js';
import { cacheProjectsListOffline } from '../services/offlineSyncService.js';
import VectorIcon from './VectorIcon.js';

export default function DataManagementSection() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const {
    projects,
    selectedProject,
    refreshProjects,
    syncStatus,
    isOffline,
    syncOfflineQueue,
    resolveSyncConflict,
    retrySyncOperation,
    retryAllFailedOperations,
    discardSyncOperation,
    toggleSimulatedOfflineMode,
  } = useProjects();
  const {
    showToast,
    reloadProjectDataFromBackend,
    projectDataConflict,
    clearProjectDataError,
  } = useWorkspace();

  const activeUserId = user && user.userId ? String(user.userId) : null;

  // Storage & Snapshot states
  const [storageStats, setStorageStats] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [serverSnapshot, setServerSnapshot] = useState(null);
  const [localSnapshots, setLocalSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [snapshotLabelInput, setSnapshotLabelInput] = useState('');

  // Export Preview Modal state
  const [exportPreview, setExportPreview] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Import & Restore state
  const [importJsonText, setImportJsonText] = useState('');
  const [importValidationError, setImportValidationError] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'replace'
  const [isImporting, setIsImporting] = useState(false);

  // Confirmation Modals for Rollback, Local Restore, and Workspace Reset
  const [confirmActionModal, setConfirmActionModal] = useState(null);
  const [isExecutingConfirmAction, setIsExecutingConfirmAction] =
    useState(false);

  // Sync busy indicator
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  const loadStorageAndSnapshots = useCallback(async () => {
    if (!activeUserId) return;
    setLoadingStorage(true);
    setLoadingSnapshots(true);
    try {
      const [storageRes, serverSnapRes, localSnaps] = await Promise.all([
        fetchStorageUsage(activeUserId),
        isOffline
          ? Promise.resolve({ ok: false, snapshot: null })
          : fetchRecoverySnapshot(),
        getLocalRecoverySnapshots(activeUserId),
      ]);
      setStorageStats(storageRes);
      if (serverSnapRes && serverSnapRes.ok) {
        setServerSnapshot(serverSnapRes.snapshot || null);
      }
      setLocalSnapshots(Array.isArray(localSnaps) ? localSnaps : []);
    } finally {
      setLoadingStorage(false);
      setLoadingSnapshots(false);
    }
  }, [activeUserId, isOffline]);

  useEffect(() => {
    loadStorageAndSnapshots();
  }, [loadStorageAndSnapshots, projects.length, syncStatus.totalQueued]);

  // =========================================================================
  // 1. OFFLINE & SYNCHRONIZATION HANDLERS
  // =========================================================================

  const handleManualSyncNow = async () => {
    if (isOffline) {
      showToast(
        'Currently in Offline Mode. Switch online to synchronize queued changes.',
        'info'
      );
      return;
    }
    setIsManualSyncing(true);
    try {
      const res = await syncOfflineQueue({
        ignoreBackoff: true,
        retryFailed: true,
      });
      await loadStorageAndSnapshots();
      if (res.conflicts > 0) {
        showToast(
          `Sync paused: ${res.conflicts} conflict(s) require resolution.`,
          'danger'
        );
      } else if (res.synced > 0) {
        showToast(
          `Synchronized ${res.synced} pending change(s) with server.`,
          'success'
        );
      } else if (res.failed > 0) {
        showToast(
          `${res.failed} operation(s) could not be synced yet.`,
          'danger'
        );
      } else {
        showToast('All project data is synchronized.', 'success');
      }
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleToggleOfflineSimulation = async () => {
    const res = await toggleSimulatedOfflineMode();
    if (res.online) {
      const syncedCount =
        res.syncResult && typeof res.syncResult.synced === 'number'
          ? res.syncResult.synced
          : 0;
      showToast(
        syncedCount > 0
          ? `Back Online · Synchronized ${syncedCount} queued operation(s)`
          : 'Back Online · Connected to Qavora server',
        'success'
      );
      await loadStorageAndSnapshots();
    } else {
      showToast(
        'Offline Mode active · Edits will be cached & queued locally',
        'info'
      );
    }
  };

  const handleResolveConflict = async (opId, resolution) => {
    setIsManualSyncing(true);
    try {
      const res = await resolveSyncConflict(opId, resolution);
      if (res.ok) {
        clearProjectDataError();
        await reloadProjectDataFromBackend();
        await loadStorageAndSnapshots();
        showToast(
          resolution === 'keep_server'
            ? 'Conflict resolved: Accepted latest server version'
            : 'Conflict resolved: Merged & saved your changes to server',
          'success'
        );
      } else {
        showToast(res.error || 'Failed to resolve conflict', 'danger');
      }
    } finally {
      setIsManualSyncing(false);
    }
  };

  // =========================================================================
  // 2. EXPORT & BACKUP HANDLERS
  // =========================================================================

  const handleExportSingleProjectJSON = async () => {
    if (!selectedProject) {
      showToast('Select a project first to export its JSON.', 'danger');
      return;
    }
    setIsExporting(true);
    try {
      const res = await exportProjectAsJSON(selectedProject);
      if (res.ok) {
        setExportPreview({
          title: `Project Export (${selectedProject.name})`,
          filename: res.filename,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
          content: res.content,
        });
        showToast(`Generated ${res.filename}`, 'success');
      } else {
        showToast(res.error || 'Export failed', 'danger');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportFullBackupJSON = async () => {
    setIsExporting(true);
    try {
      const sourceProjects =
        projects.length > 0
          ? projects
          : selectedProject
          ? [selectedProject]
          : [];
      const res = await exportFullBackup(sourceProjects, [], { user });
      if (res.ok) {
        setExportPreview({
          title: 'Full Workspace Backup (JSON)',
          filename: res.filename,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
          content: res.content,
        });
        showToast(`Generated ${res.filename}`, 'success');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCSV = async (csvType) => {
    const sourceProjects = selectedProject
      ? [selectedProject]
      : projects.length > 0
      ? projects
      : [];
    if (sourceProjects.length === 0) {
      showToast('No project data available to export.', 'danger');
      return;
    }

    setIsExporting(true);
    try {
      let res;
      let label = '';
      if (csvType === 'testcases') {
        res = await exportTestCasesCSV(sourceProjects);
        label = 'Test Cases CSV';
      } else if (csvType === 'executions') {
        res = await exportExecutionsCSV(sourceProjects);
        label = 'Executions CSV';
      } else {
        res = await exportDefectsCSV(sourceProjects);
        label = 'Defects CSV';
      }

      if (res && res.ok) {
        setExportPreview({
          title: `${label} (${res.rowCount} rows)`,
          filename: res.filename,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
          content: res.content,
        });
        showToast(`Exported ${res.filename} (${res.rowCount} rows)`, 'success');
      }
    } finally {
      setIsExporting(false);
    }
  };

  // =========================================================================
  // 3. IMPORT VALIDATION, PREVIEW & EXECUTION HANDLERS
  // =========================================================================

  const handleLoadSampleBackupIntoEditor = () => {
    const sourceProjects =
      projects.length > 0
        ? projects
        : selectedProject
        ? [selectedProject]
        : [];
    const payload = createFullBackupPayload(sourceProjects, [], user);
    setImportJsonText(JSON.stringify(payload, null, 2));
    setImportValidationError(null);
    showToast(
      'Loaded current workspace backup JSON into import editor',
      'info'
    );
  };

  const handleValidateAndPreviewImport = () => {
    setImportValidationError(null);
    const validation = parseAndValidateImportPayload(importJsonText, {
      fileName: 'Qavora_Import.json',
      fileSize: importJsonText.length,
      existingProjects: projects,
    });

    if (!validation.ok) {
      setImportValidationError(validation.error);
      showToast(validation.error, 'danger');
      return;
    }

    setImportMode('merge');
    setImportPreview(validation);
  };

  const handleExecuteImport = async () => {
    if (!importPreview || !importPreview.ok) return;
    setIsImporting(true);
    try {
      // Always create a local safety snapshot before Destructive Replace
      if (importMode === 'replace' && activeUserId && projects.length > 0) {
        await createLocalRecoverySnapshot({
          userId: activeUserId,
          projects,
          label: 'Pre-Import Safety Snapshot',
          reason: 'pre_replace_import',
        });
      }

      if (isOffline && activeUserId) {
        // Offline import fallback: merge or replace in user's offline project cache
        let nextProjects = [];
        if (importMode === 'replace') {
          nextProjects = importPreview.projects.map((p) => ({
            ...p,
            userId: activeUserId,
          }));
        } else {
          const existingIds = new Set(projects.map((p) => p.id));
          const mergedIncoming = importPreview.projects.map((p) => {
            if (existingIds.has(p.id)) {
              return {
                ...p,
                id: `proj_${Date.now()}_${Math.random()
                  .toString(36)
                  .slice(2, 7)}`,
                name: `${p.name} (Imported)`,
                userId: activeUserId,
              };
            }
            return { ...p, userId: activeUserId };
          });
          nextProjects = [...mergedIncoming, ...projects];
        }

        await cacheProjectsListOffline(nextProjects, activeUserId);
        await refreshProjects();
        await loadStorageAndSnapshots();
        setImportPreview(null);
        setImportJsonText('');
        showToast(
          `Imported ${importPreview.projectsCount} project(s) into offline workspace (${importMode.toUpperCase()})`,
          'success'
        );
        return;
      }

      const res = await importWorkspaceData({
        mode: importMode,
        projects: importPreview.projects,
        checklists: importPreview.checklists,
      });

      if (!res.ok) {
        showToast(res.error || 'Import failed', 'danger');
        return;
      }

      await refreshProjects({ autoSelectFirst: true });
      await loadStorageAndSnapshots();
      setImportPreview(null);
      setImportJsonText('');
      showToast(
        res.message ||
          `Imported ${importPreview.projectsCount} project(s) (${importMode})`,
        'success'
      );
    } finally {
      setIsImporting(false);
    }
  };

  // =========================================================================
  // 4. RECOVERY SNAPSHOT & ROLLBACK HANDLERS
  // =========================================================================

  const handleCreateLocalSnapshot = async () => {
    if (!activeUserId) return;
    const label =
      snapshotLabelInput.trim() ||
      `Manual Snapshot (${new Date().toLocaleTimeString()})`;
    const res = await createLocalRecoverySnapshot({
      userId: activeUserId,
      projects,
      label,
      reason: 'manual',
    });
    if (res.ok) {
      setSnapshotLabelInput('');
      await loadStorageAndSnapshots();
      showToast(`Created recovery snapshot "${label}"`, 'success');
    } else {
      showToast(res.error || 'Failed to create snapshot', 'danger');
    }
  };

  const handleDeleteServerSnapshot = async () => {
    const res = await clearRecoverySnapshot();
    if (res.ok) {
      setServerSnapshot(null);
      showToast('Cleared server recovery snapshot', 'info');
    } else {
      showToast(res.error || 'Failed to clear server snapshot', 'danger');
    }
  };

  const handleDeleteLocalSnapshot = async (snapshotId) => {
    if (!activeUserId) return;
    const res = await deleteLocalRecoverySnapshot(snapshotId, activeUserId);
    if (res.ok) {
      await loadStorageAndSnapshots();
      showToast('Removed local recovery snapshot', 'info');
    }
  };

  const handleConfirmProtectedAction = async () => {
    if (!confirmActionModal) return;
    setIsExecutingConfirmAction(true);
    try {
      const { type, snapshotId, mode } = confirmActionModal;

      if (type === 'server_rollback') {
        const res = await executeRollback();
        if (res.ok) {
          await refreshProjects({ autoSelectFirst: true });
          await loadStorageAndSnapshots();
          setConfirmActionModal(null);
          showToast(
            res.message || 'Rolled back workspace to recovery snapshot',
            'success'
          );
        } else {
          showToast(res.error || 'Rollback failed', 'danger');
        }
        return;
      }

      if (type === 'local_restore' && snapshotId && activeUserId) {
        const res = await restoreLocalRecoverySnapshot(
          snapshotId,
          activeUserId,
          {
            mode: mode || 'replace',
            offlineOnly: isOffline,
          }
        );
        if (res.ok) {
          await refreshProjects({ autoSelectFirst: true });
          await loadStorageAndSnapshots();
          setConfirmActionModal(null);
          showToast(
            `Restored snapshot "${res.snapshot.label}" (${res.mode})`,
            'success'
          );
        } else {
          showToast(res.error || 'Failed to restore snapshot', 'danger');
        }
        return;
      }

      if (type === 'workspace_reset') {
        if (activeUserId && projects.length > 0) {
          await createLocalRecoverySnapshot({
            userId: activeUserId,
            projects,
            label: 'Pre-Reset Emergency Snapshot',
            reason: 'pre_reset',
          });
        }
        const res = await resetWorkspaceData();
        if (res.ok) {
          await cacheProjectsListOffline([], activeUserId);
          await refreshProjects();
          await loadStorageAndSnapshots();
          setConfirmActionModal(null);
          showToast(
            res.message || 'All cloud workspace test data has been reset',
            'info'
          );
        } else {
          showToast(res.error || 'Failed to reset workspace data', 'danger');
        }
      }
    } finally {
      setIsExecutingConfirmAction(false);
    }
  };

  const conflictedOps = (syncStatus.operations || []).filter(
    (op) => op.status === 'conflict' || op.requiresManualResolution
  );

  const statusToneColor =
    conflictedOps.length > 0 || projectDataConflict
      ? colors.danger
      : isOffline
      ? colors.warning
      : syncStatus.isSyncing || isManualSyncing
      ? colors.primary
      : colors.success;

  const statusLabel =
    conflictedOps.length > 0 || projectDataConflict
      ? 'CONFLICT DETECTED'
      : isOffline
      ? 'OFFLINE MODE'
      : syncStatus.isSyncing || isManualSyncing
      ? 'SYNCING...'
      : syncStatus.pendingCount > 0
      ? `${syncStatus.pendingCount} PENDING SYNC`
      : 'ONLINE & SYNCED';

  return (
    <View style={styles.sectionStack}>
      {/* =================================================================== */}
      {/* 1. OFFLINE & SYNCHRONIZATION CENTER                                 */}
      {/* =================================================================== */}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderTextCol}>
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              OFFLINE-FIRST SYNCHRONIZATION ENGINE
            </Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Offline Cache & Mutation Queue
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: colors.background,
                borderColor: statusToneColor,
              },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusToneColor },
              ]}
            />
            <Text
              style={[
                styles.statusBadgeText,
                { color: statusToneColor, fontFamily: monoFontFamily },
              ]}
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
          Project edits made while offline are persisted per-user in AsyncStorage,
          deduplicated, and synchronized automatically with optimistic concurrency
          (expectedUpdatedAt) when connectivity returns.
        </Text>

        {/* Sync Counters Grid */}
        <View
          style={[
            styles.metricsGrid,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={styles.metricCell}>
            <Text
              style={[
                styles.metricValue,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              {syncStatus.pendingCount}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
              Pending
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text
              style={[
                styles.metricValue,
                {
                  color:
                    syncStatus.conflictCount > 0 ? colors.danger : colors.text,
                  fontFamily: monoFontFamily,
                },
              ]}
            >
              {syncStatus.conflictCount}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
              Conflicts
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text
              style={[
                styles.metricValue,
                {
                  color:
                    syncStatus.failedCount > 0 ? colors.warning : colors.text,
                  fontFamily: monoFontFamily,
                },
              ]}
            >
              {syncStatus.failedCount}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
              Failed
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text
              style={[
                styles.metricValue,
                { color: colors.success, fontFamily: monoFontFamily },
              ]}
            >
              {projects.length}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
              Cached Projects
            </Text>
          </View>
        </View>

        {/* Sync Action Buttons */}
        <View style={styles.actionButtonsRow}>
          <Pressable
            onPress={handleManualSyncNow}
            disabled={isOffline || isManualSyncing}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: isOffline
                  ? colors.border
                  : colors.primary,
                opacity: isOffline || isManualSyncing ? 0.65 : 1,
              },
            ]}
          >
            {isManualSyncing ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <VectorIcon
                name="refresh"
                size={15}
                color={colors.textOnPrimary}
              />
            )}
            <Text
              style={[
                styles.primaryBtnText,
                { color: colors.textOnPrimary },
              ]}
            >
              {isManualSyncing
                ? 'Synchronizing...'
                : `Sync Queue Now (${syncStatus.totalQueued})`}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleToggleOfflineSimulation}
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: isOffline
                  ? colors.warningSoft || colors.surfaceAccent
                  : colors.background,
                borderColor: isOffline ? colors.warning : colors.borderStrong,
              },
            ]}
          >
            <VectorIcon
              name="globe"
              size={15}
              color={isOffline ? colors.warning : colors.text}
            />
            <Text
              style={[
                styles.secondaryBtnText,
                { color: isOffline ? colors.warning : colors.text },
              ]}
            >
              {isOffline
                ? 'Reconnect & Sync Online'
                : 'Simulate Offline Mode'}
            </Text>
          </Pressable>

          {syncStatus.failedCount > 0 ? (
            <Pressable
              onPress={() => retryAllFailedOperations()}
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.warning,
                },
              ]}
            >
              <Text
                style={[styles.secondaryBtnText, { color: colors.warning }]}
              >
                Retry All Failed ({syncStatus.failedCount})
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* HTTP 409 Conflict Resolution Cards */}
        {conflictedOps.map((op) => (
          <View
            key={op.id}
            style={[
              styles.conflictCard,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <View style={styles.conflictHeaderRow}>
              <VectorIcon name="alert" size={16} color={colors.danger} />
              <Text style={[styles.conflictTitle, { color: colors.danger }]}>
                HTTP 409 Sync Conflict · {op.description || op.entityType}
              </Text>
            </View>
            <Text
              style={[styles.conflictDesc, { color: colors.textSecondary }]}
            >
              {op.conflictDetails?.message ||
                op.lastError ||
                'This project was modified on the server while your device had unsynchronized offline changes.'}
            </Text>
            <Text
              style={[
                styles.conflictMeta,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              Baseline: {op.expectedUpdatedAt || 'N/A'} · Server:{' '}
              {op.conflictDetails?.currentUpdatedAt || 'Newer'}
            </Text>
            <View style={styles.conflictActionsRow}>
              <Pressable
                onPress={() => handleResolveConflict(op.id, 'merge')}
                style={[
                  styles.smallActionBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.smallActionBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Merge & Save Local Changes
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleResolveConflict(op.id, 'keep_server')}
                style={[
                  styles.smallActionBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text
                  style={[styles.smallActionBtnText, { color: colors.danger }]}
                >
                  Accept Server Version
                </Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* Queued Operations List */}
        {syncStatus.operations && syncStatus.operations.length > 0 ? (
          <View style={styles.queueListWrap}>
            <Text
              style={[
                styles.subHeaderLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              QUEUED OPERATIONS ({syncStatus.operations.length})
            </Text>
            {syncStatus.operations.map((op) => (
              <View
                key={op.id}
                style={[
                  styles.queueItemRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.queueItemTextCol}>
                  <Text style={[styles.queueItemTitle, { color: colors.text }]}>
                    [{op.operationType}] {op.description || op.entityType}
                  </Text>
                  <Text
                    style={[
                      styles.queueItemMeta,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    Status: {op.status.toUpperCase()} · Retries: {op.retryCount || 0}
                    {op.lastError ? ` · ${op.lastError}` : ''}
                  </Text>
                </View>
                <View style={styles.queueItemBtns}>
                  {op.status !== 'conflict' ? (
                    <Pressable
                      onPress={() => retrySyncOperation(op.id)}
                      style={[
                        styles.tinyBtn,
                        {
                          backgroundColor: colors.surfaceAccent,
                          borderColor: colors.primary,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.tinyBtnText, { color: colors.primary }]}
                      >
                        Sync
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => discardSyncOperation(op.id)}
                    style={[
                      styles.tinyBtn,
                      {
                        backgroundColor: colors.dangerSoft,
                        borderColor: colors.danger,
                      },
                    ]}
                  >
                    <Text style={[styles.tinyBtnText, { color: colors.danger }]}>
                      Discard
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* =================================================================== */}
      {/* 2. DATABASE & LOCAL STORAGE FOOTPRINT                               */}
      {/* =================================================================== */}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderTextCol}>
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              STORAGE & DATABASE TELEMETRY
            </Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              MongoDB Atlas & Device Cache Usage
            </Text>
          </View>
          <Pressable
            onPress={loadStorageAndSnapshots}
            disabled={loadingStorage}
            style={[
              styles.tinyBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.tinyBtnText, { color: colors.text }]}>
              {loadingStorage ? 'Loading...' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        {storageStats && storageStats.storage ? (
          <View style={styles.storageBlock}>
            <View style={styles.storageBarHeader}>
              <Text
                style={[
                  styles.storageTextStrong,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                MongoDB Used: {storageStats.storage.usedMb} MB /{' '}
                {storageStats.storage.capacityMb} MB (
                {storageStats.storage.usagePercentage}%)
              </Text>
              <Text
                style={[
                  styles.storageTextSub,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                {storageStats.metadata?.objects || 0} docs ·{' '}
                {storageStats.metadata?.collections || 0} collections
              </Text>
            </View>
            <View
              style={[
                styles.progressTrack,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.min(
                      100,
                      Math.max(2, storageStats.storage.usagePercentage || 2)
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
        ) : (
          <Text
            style={[
              styles.storageTextSub,
              {
                color: colors.textMuted,
                fontFamily: monoFontFamily,
                marginBottom: 8,
              },
            ]}
          >
            {isOffline
              ? 'Cloud storage telemetry paused while in Offline Mode.'
              : 'Cloud storage telemetry ready on backend connection.'}
          </Text>
        )}

        <View
          style={[
            styles.localStatsRow,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.storageTextSub,
              { color: colors.textSecondary, fontFamily: monoFontFamily },
            ]}
          >
            Local AsyncStorage Cache:{' '}
            {storageStats?.local?.estimatedLocalKb ?? 0} KB ·{' '}
            {storageStats?.local?.cachedProjectsCount ?? projects.length}{' '}
            projects · {storageStats?.local?.localSnapshotsCount ?? localSnapshots.length}{' '}
            local snapshots
          </Text>
        </View>
      </View>

      {/* =================================================================== */}
      {/* 3. EXPORT & BACKUP GENERATORS                                       */}
      {/* =================================================================== */}
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
          PROJECT DATA EXPORT & FULL WORKSPACE BACKUP
        </Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Export QA Artifacts (JSON & CSV)
        </Text>
        <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
          Generate standardized exports 100% compatible with Qavora Web
          (backupVersion 1 / schemaVersion 1).
        </Text>

        <View style={styles.actionButtonsRow}>
          <Pressable
            onPress={handleExportFullBackupJSON}
            disabled={isExporting}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          >
            <VectorIcon name="layers" size={15} color={colors.textOnPrimary} />
            <Text
              style={[styles.primaryBtnText, { color: colors.textOnPrimary }]}
            >
              Export Full Backup (JSON)
            </Text>
          </Pressable>

          <Pressable
            onPress={handleExportSingleProjectJSON}
            disabled={isExporting || !selectedProject}
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: colors.surfaceAccent,
                borderColor: colors.primary,
                opacity: selectedProject ? 1 : 0.5,
              },
            ]}
          >
            <VectorIcon name="folder" size={15} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
              Export Active Project (JSON)
            </Text>
          </Pressable>
        </View>

        <View style={[styles.actionButtonsRow, { marginTop: 8 }]}>
          <Pressable
            onPress={() => handleExportCSV('testcases')}
            disabled={isExporting}
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
              Test Cases (CSV)
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleExportCSV('executions')}
            disabled={isExporting}
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
              Executions (CSV)
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleExportCSV('defects')}
            disabled={isExporting}
            style={[
              styles.secondaryBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
              Defects (CSV)
            </Text>
          </Pressable>
        </View>
      </View>

      {/* =================================================================== */}
      {/* 4. IMPORT & RESTORE WORKSPACE BACKUP                                */}
      {/* =================================================================== */}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderTextCol}>
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              IMPORT & RESTORE BACKUP
            </Text>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Restore from Qavora Backup JSON
            </Text>
          </View>
          <Pressable
            onPress={handleLoadSampleBackupIntoEditor}
            style={[
              styles.tinyBtn,
              {
                backgroundColor: colors.surfaceAccent,
                borderColor: colors.primary,
              },
            ]}
          >
            <Text style={[styles.tinyBtnText, { color: colors.primary }]}>
              Load Current Backup JSON
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
          Supports Full Application Backups, Multi-Project Archives, and
          Individual Project JSON exports. Malformed JSON, prohibited operator
          keys, and incompatible schema versions are strictly rejected.
        </Text>

        <TextInput
          value={importJsonText}
          onChangeText={(txt) => {
            setImportJsonText(txt);
            if (importValidationError) setImportValidationError(null);
          }}
          placeholder='Paste Qavora Full Backup or Project JSON here, or tap "Load Current Backup JSON" above...'
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={5}
          style={[
            styles.jsonTextArea,
            {
              backgroundColor: colors.background,
              borderColor: importValidationError
                ? colors.danger
                : colors.border,
              color: colors.text,
              fontFamily: monoFontFamily,
            },
          ]}
        />

        {importValidationError ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <Text style={[styles.errorBannerText, { color: colors.danger }]}>
              {importValidationError}
            </Text>
          </View>
        ) : null}

        <View style={styles.actionButtonsRow}>
          <Pressable
            onPress={handleValidateAndPreviewImport}
            disabled={!importJsonText.trim()}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: importJsonText.trim()
                  ? colors.primary
                  : colors.border,
              },
            ]}
          >
            <VectorIcon name="check" size={15} color={colors.textOnPrimary} />
            <Text
              style={[styles.primaryBtnText, { color: colors.textOnPrimary }]}
            >
              Validate & Preview Import
            </Text>
          </Pressable>

          {importJsonText ? (
            <Pressable
              onPress={() => {
                setImportJsonText('');
                setImportValidationError(null);
              }}
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                Clear Input
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* =================================================================== */}
      {/* 5. RECOVERY SNAPSHOTS & WORKSPACE ROLLBACK                          */}
      {/* =================================================================== */}
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
          POINT-IN-TIME RECOVERY SNAPSHOTS & ROLLBACK
        </Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Server & Local Recovery Points
        </Text>
        <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
          Destructive imports automatically generate a server recovery snapshot
          (/api/data/recovery-snapshot). You can also create manual local
          recovery snapshots at any time.
        </Text>

        {/* Server Recovery Snapshot Box */}
        <View
          style={[
            styles.snapshotBox,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.subHeaderLabel,
              { color: colors.primary, fontFamily: monoFontFamily },
            ]}
          >
            CLOUD RECOVERY SNAPSHOT (/api/data/recovery-snapshot)
          </Text>
          {serverSnapshot ? (
            <View style={{ gap: 8 }}>
              <Text style={[styles.snapshotTitle, { color: colors.text }]}>
                Snapshot ID: {serverSnapshot.snapshotId}
              </Text>
              <Text
                style={[
                  styles.snapshotMeta,
                  { color: colors.textSecondary, fontFamily: monoFontFamily },
                ]}
              >
                Created: {serverSnapshot.createdAt || serverSnapshot.timestamp} ·{' '}
                {serverSnapshot.projectsCount} projects ·{' '}
                {serverSnapshot.checklistsCount || 0} checklists
              </Text>
              <View style={styles.actionButtonsRow}>
                <Pressable
                  onPress={() =>
                    setConfirmActionModal({
                      type: 'server_rollback',
                      title: 'Rollback Workspace to Server Snapshot?',
                      description: `This will restore ${serverSnapshot.projectsCount} project(s) from snapshot "${serverSnapshot.snapshotId}" (${serverSnapshot.createdAt}) and overwrite current cloud workspace changes.`,
                    })
                  }
                  style={[
                    styles.smallActionBtn,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.smallActionBtnText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Rollback Workspace
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleDeleteServerSnapshot}
                  style={[
                    styles.smallActionBtn,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text
                    style={[styles.smallActionBtnText, { color: colors.danger }]}
                  >
                    Clear Server Snapshot
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={[styles.snapshotMeta, { color: colors.textMuted }]}>
              {loadingSnapshots
                ? 'Checking server recovery snapshot...'
                : 'No server recovery snapshot currently stored. A server snapshot is automatically created before any Destructive Replace import.'}
            </Text>
          )}
        </View>

        {/* Create Local Recovery Snapshot Row */}
        <View style={styles.createSnapshotRow}>
          <TextInput
            value={snapshotLabelInput}
            onChangeText={setSnapshotLabelInput}
            placeholder="Snapshot label (e.g., Pre-Release Regression)"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.snapshotInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          />
          <Pressable
            onPress={handleCreateLocalSnapshot}
            style={[
              styles.createSnapshotBtn,
              { backgroundColor: colors.primary },
            ]}
          >
            <VectorIcon name="plus" size={14} color={colors.textOnPrimary} />
            <Text
              style={[
                styles.createSnapshotBtnText,
                { color: colors.textOnPrimary },
              ]}
            >
              Create Snapshot
            </Text>
          </Pressable>
        </View>

        {/* Local Recovery Snapshots List */}
        {localSnapshots.length > 0 ? (
          <View style={styles.queueListWrap}>
            <Text
              style={[
                styles.subHeaderLabel,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              SAVED LOCAL SNAPSHOTS ({localSnapshots.length})
            </Text>
            {localSnapshots.map((snap) => (
              <View
                key={snap.snapshotId}
                style={[
                  styles.queueItemRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.queueItemTextCol}>
                  <Text style={[styles.queueItemTitle, { color: colors.text }]}>
                    {snap.label}
                  </Text>
                  <Text
                    style={[
                      styles.queueItemMeta,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    {snap.createdAt} · {snap.projectsCount} projects ·{' '}
                    {snap.metadata?.totalTestCases ?? 0} cases ·{' '}
                    {snap.metadata?.totalDefects ?? 0} defects
                  </Text>
                </View>
                <View style={styles.queueItemBtns}>
                  <Pressable
                    onPress={() =>
                      setConfirmActionModal({
                        type: 'local_restore',
                        snapshotId: snap.snapshotId,
                        mode: 'merge',
                        title: `Merge Snapshot "${snap.label}"?`,
                        description: `Safe Merge will restore ${snap.projectsCount} project(s) from ${snap.createdAt} without deleting your existing projects.`,
                      })
                    }
                    style={[
                      styles.tinyBtn,
                      {
                        backgroundColor: colors.surfaceAccent,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.tinyBtnText, { color: colors.primary }]}
                    >
                      Merge
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setConfirmActionModal({
                        type: 'local_restore',
                        snapshotId: snap.snapshotId,
                        mode: 'replace',
                        title: `Replace Workspace with "${snap.label}"?`,
                        description: `Destructive Replace will overwrite your workspace with the ${snap.projectsCount} project(s) captured on ${snap.createdAt}.`,
                      })
                    }
                    style={[
                      styles.tinyBtn,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.warning,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.tinyBtnText, { color: colors.warning }]}
                    >
                      Replace
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteLocalSnapshot(snap.snapshotId)}
                    style={[
                      styles.tinyBtn,
                      {
                        backgroundColor: colors.dangerSoft,
                        borderColor: colors.danger,
                      },
                    ]}
                  >
                    <Text style={[styles.tinyBtnText, { color: colors.danger }]}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* =================================================================== */}
      {/* 6. DANGER ZONE: CLOUD WORKSPACE RESET (/api/data/reset)             */}
      {/* =================================================================== */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.danger,
          },
        ]}
      >
        <Text
          style={[
            styles.sectionKicker,
            { color: colors.danger, fontFamily: monoFontFamily },
          ]}
        >
          DANGER ZONE · DESTRUCTIVE WORKSPACE RESET
        </Text>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Reset All Cloud & Local Workspace Data
        </Text>
        <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
          Permanently deletes all projects, test plans, suites, test cases,
          execution runs, and defects belonging to your account via POST
          /api/data/reset. An emergency local snapshot is created automatically.
        </Text>

        <View style={styles.actionButtonsRow}>
          <Pressable
            onPress={() =>
              setConfirmActionModal({
                type: 'workspace_reset',
                title: 'Reset All Workspace Data?',
                description:
                  'This will permanently delete all projects, test plans, suites, test cases, executions, and defects for your account on the server.',
              })
            }
            style={[
              styles.dangerBtn,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
              },
            ]}
          >
            <VectorIcon name="trash" size={15} color={colors.danger} />
            <Text style={[styles.dangerBtnText, { color: colors.danger }]}>
              Reset All Workspace Data (/api/data/reset)
            </Text>
          </Pressable>
        </View>
      </View>

      {/* =================================================================== */}
      {/* MODAL A: EXPORT PREVIEW MODAL                                       */}
      {/* =================================================================== */}
      <Modal
        visible={Boolean(exportPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setExportPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.sectionKicker,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  EXPORT GENERATED
                </Text>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {exportPreview?.title}
                </Text>
                <Text
                  style={[
                    styles.snapshotMeta,
                    { color: colors.textMuted, fontFamily: monoFontFamily },
                  ]}
                >
                  {exportPreview?.filename} · {exportPreview?.sizeBytes || 0}{' '}
                  bytes
                </Text>
              </View>
              <Pressable
                onPress={() => setExportPreview(null)}
                style={[
                  styles.tinyBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text style={[styles.tinyBtnText, { color: colors.text }]}>
                  Close
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={[
                styles.previewScrollBox,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                selectable
                style={[
                  styles.previewCodeText,
                  { color: colors.text, fontFamily: monoFontFamily },
                ]}
              >
                {exportPreview?.content
                  ? exportPreview.content.slice(0, 6000)
                  : ''}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL B: IMPORT PREVIEW & CONFIRMATION MODAL                        */}
      {/* =================================================================== */}
      <Modal
        visible={Boolean(importPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setImportPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              VALIDATED IMPORT PREVIEW
            </Text>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Confirm Workspace Restore ({importPreview?.formatType})
            </Text>

            <View
              style={[
                styles.metricsGrid,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.metricCell}>
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  {importPreview?.projectsCount ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                  Projects
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.text, fontFamily: monoFontFamily },
                  ]}
                >
                  {importPreview?.suitesCount ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                  Suites
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.success, fontFamily: monoFontFamily },
                  ]}
                >
                  {importPreview?.casesCount ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                  Test Cases
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text
                  style={[
                    styles.metricValue,
                    { color: colors.danger, fontFamily: monoFontFamily },
                  ]}
                >
                  {importPreview?.defectsCount ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textMuted }]}>
                  Defects
                </Text>
              </View>
            </View>

            {importPreview?.warnings && importPreview.warnings.length > 0 ? (
              <View
                style={[
                  styles.warningBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.warning,
                  },
                ]}
              >
                {importPreview.warnings.map((w, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.warningText,
                      { color: colors.warning, fontFamily: monoFontFamily },
                    ]}
                  >
                    • {w}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text
              style={[
                styles.subHeaderLabel,
                { color: colors.textSecondary, fontFamily: monoFontFamily },
              ]}
            >
              SELECT IMPORT MODE:
            </Text>

            <View style={styles.modeSelectorCol}>
              <Pressable
                onPress={() => setImportMode('merge')}
                style={[
                  styles.modeOptionCard,
                  {
                    backgroundColor:
                      importMode === 'merge'
                        ? colors.surfaceAccent
                        : colors.background,
                    borderColor:
                      importMode === 'merge' ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modeOptionTitle,
                    {
                      color:
                        importMode === 'merge' ? colors.primary : colors.text,
                    },
                  ]}
                >
                  Safe Merge (Recommended)
                </Text>
                <Text
                  style={[
                    styles.modeOptionDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Preserves all existing projects. Duplicate project IDs are
                  imported as new copies with "(Imported)" appended.
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setImportMode('replace')}
                style={[
                  styles.modeOptionCard,
                  {
                    backgroundColor:
                      importMode === 'replace'
                        ? colors.dangerSoft
                        : colors.background,
                    borderColor:
                      importMode === 'replace' ? colors.danger : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modeOptionTitle,
                    {
                      color:
                        importMode === 'replace' ? colors.danger : colors.text,
                    },
                  ]}
                >
                  Destructive Replace (Creates Recovery Snapshot)
                </Text>
                <Text
                  style={[
                    styles.modeOptionDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Creates a recovery snapshot first, then replaces all existing
                  workspace projects with the imported backup.
                </Text>
              </Pressable>
            </View>

            <View style={styles.actionButtonsRow}>
              <Pressable
                onPress={handleExecuteImport}
                disabled={isImporting}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor:
                      importMode === 'replace' ? colors.danger : colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.primaryBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  {isImporting
                    ? 'Importing...'
                    : importMode === 'replace'
                    ? 'Confirm Destructive Replace'
                    : 'Execute Safe Merge'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setImportPreview(null)}
                disabled={isImporting}
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
            </View>
          </View>
        </View>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL C: CONFIRMATION FOR ROLLBACK / SNAPSHOT RESTORE / RESET       */}
      {/* =================================================================== */}
      <Modal
        visible={Boolean(confirmActionModal)}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmActionModal(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.sectionKicker,
                { color: colors.danger, fontFamily: monoFontFamily },
              ]}
            >
              CONFIRM PROTECTED DATA OPERATION
            </Text>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {confirmActionModal?.title}
            </Text>
            <Text
              style={[styles.sectionDesc, { color: colors.textSecondary }]}
            >
              {confirmActionModal?.description}
            </Text>

            {confirmActionModal?.type === 'workspace_reset' ? (
              <Pressable
                onPress={handleExportFullBackupJSON}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: colors.surfaceAccent,
                    borderColor: colors.primary,
                    marginBottom: 10,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryBtnText, { color: colors.primary }]}
                >
                  Download Full Backup First
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.actionButtonsRow}>
              <Pressable
                onPress={handleConfirmProtectedAction}
                disabled={isExecutingConfirmAction}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.danger },
                ]}
              >
                <Text
                  style={[
                    styles.primaryBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  {isExecutingConfirmAction
                    ? 'Processing...'
                    : 'Confirm & Proceed'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setConfirmActionModal(null)}
                disabled={isExecutingConfirmAction}
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
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionStack: {
    gap: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  cardHeaderTextCol: {
    flex: 1,
    minWidth: 180,
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 12,
    gap: 6,
  },
  metricCell: {
    flex: 1,
    minWidth: 66,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    minWidth: 150,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryBtn: {
    flex: 1,
    minWidth: 135,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  dangerBtn: {
    flex: 1,
    minWidth: 160,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  dangerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  conflictCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  conflictHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conflictTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  conflictDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  conflictMeta: {
    fontSize: 11,
  },
  conflictActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  smallActionBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  queueListWrap: {
    marginTop: 12,
    gap: 8,
  },
  subHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  queueItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  queueItemTextCol: {
    flex: 1,
    minWidth: 160,
  },
  queueItemTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  queueItemMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  queueItemBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tinyBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tinyBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  storageBlock: {
    marginBottom: 10,
    gap: 6,
  },
  storageBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
  },
  storageTextStrong: {
    fontSize: 12,
    fontWeight: '700',
  },
  storageTextSub: {
    fontSize: 11,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  localStatsRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  jsonTextArea: {
    minHeight: 110,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  errorBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  snapshotBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  snapshotTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  snapshotMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  createSnapshotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  snapshotInput: {
    flex: 1,
    minWidth: 180,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  createSnapshotBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  createSnapshotBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 22, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '88%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  previewScrollBox: {
    maxHeight: 340,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  previewCodeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  warningText: {
    fontSize: 11,
    lineHeight: 16,
  },
  modeSelectorCol: {
    gap: 8,
    marginBottom: 4,
  },
  modeOptionCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 3,
  },
  modeOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  modeOptionDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
});

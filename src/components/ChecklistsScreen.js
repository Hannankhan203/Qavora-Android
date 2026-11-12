import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import {
  useWorkspace,
  useWorkspaceBackOverlay,
} from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
import styles from './checklists/checklistsStyles';
import ChecklistEditItemModal from './checklists/ChecklistEditItemModal';
import ChecklistFormModal from './checklists/ChecklistFormModal';
import ChecklistDeleteModal from './checklists/ChecklistDeleteModal';
import ChecklistPromoteModal from './checklists/ChecklistPromoteModal';
import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  CHECKLIST_STARTER_TEMPLATES,
  normalizeChecklistRecord,
  filterChecklistsForUser,
  filterChecklistsByProject,
  computeChecklistsSummaryMetrics,
  getCachedChecklistsForUser,
  cacheChecklistsForUser,
  fetchChecklists,
  fetchChecklistById,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  toggleChecklistItemCompletion,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  markAllChecklistItems,
  buildChecklistPromotionPreview,
  promoteChecklistToProject,
} from '../services/checklistService';
import {
  subscribeToSyncEvents,
  retryProjectOperation,
} from '../services/offlineSyncService';

export default function ChecklistsScreen({
  embedded = false,
  onBackToOverview,
  activeChecklistId: controlledActiveChecklistId,
  onChangeActiveChecklistId,
  createModalOpen: controlledCreateModalOpen,
  onChangeCreateModalOpen,
  initialTemplateId,
  onResetTemplateId,
}) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const {
    selectedProject,
    projects,
    selectProject,
    updateProjectData,
    refreshProjects,
    getProject,
    isOfflineMode,
    syncStatus,
    syncNow,
    retryFailedSync,
    resolveSyncConflict,
  } = useProjects();
  const {
    showToast,
    setActiveTab,
    openWorkspace,
    reloadProjectDataFromBackend,
    checklists: workspaceChecklists,
    setChecklists: setWorkspaceChecklists,
    activeChecklistId: contextActiveChecklistId,
    setActiveChecklistId: setContextActiveChecklistId,
    checklistCreateModalOpen: contextCreateModalOpen,
    setChecklistCreateModalOpen: setContextCreateModalOpen,
    checklistCreateTemplateId: contextCreateTemplateId,
    setChecklistCreateTemplateId: setContextCreateTemplateId,
    notifyBlockedSwipeTouchStart,
  } = useWorkspace();

  const currentUserId = useMemo(
    () =>
      user && (user.userId || user.id || user._id)
        ? String(user.userId || user.id || user._id).trim()
        : '',
    [user]
  );
  const selectedProjectId = useMemo(
    () =>
      selectedProject && (selectedProject.id || selectedProject._id)
        ? String(selectedProject.id || selectedProject._id).trim()
        : '',
    [selectedProject]
  );

  // Primary state
  const [checklists, setChecklistsState] = useState(() =>
    Array.isArray(workspaceChecklists) ? workspaceChecklists : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFromOfflineCache, setIsFromOfflineCache] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [authExpiredError, setAuthExpiredError] = useState(false);

  // Scope & filtering state
  const [scopeFilter, setScopeFilter] = useState(
    selectedProjectId ? 'project' : 'all'
  ); // 'project' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Active checklist detail & item filters (Synchronized with centralized navigation state)
  const [localActiveChecklistId, setLocalActiveChecklistId] = useState(
    controlledActiveChecklistId !== undefined
      ? controlledActiveChecklistId
      : contextActiveChecklistId || null
  );
  const activeChecklistId =
    controlledActiveChecklistId !== undefined
      ? controlledActiveChecklistId
      : contextActiveChecklistId !== undefined
      ? contextActiveChecklistId
      : localActiveChecklistId;

  const setActiveChecklistId = useCallback(
    (nextId) => {
      const resolvedId =
        typeof nextId === 'function' ? nextId(activeChecklistId) : nextId;
      setLocalActiveChecklistId(resolvedId);
      if (typeof onChangeActiveChecklistId === 'function') {
        onChangeActiveChecklistId(resolvedId);
      }
      if (typeof setContextActiveChecklistId === 'function') {
        setContextActiveChecklistId(resolvedId);
      }
    },
    [
      activeChecklistId,
      onChangeActiveChecklistId,
      setContextActiveChecklistId,
    ]
  );

  const [itemFilterMode, setItemFilterMode] = useState('all'); // 'all' | 'pending' | 'completed'
  const [busyMutation, setBusyMutation] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);

  // New item composer inside active checklist detail
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemPriority, setNewItemPriority] = useState('Medium');
  const [newItemNotes, setNewItemNotes] = useState('');

  // Edit existing item modal state
  const [editingItem, setEditingItem] = useState(null);
  const [editItemTitle, setEditItemTitle] = useState('');
  const [editItemPriority, setEditItemPriority] = useState('Medium');
  const [editItemCategory, setEditItemCategory] = useState('General QA');
  const [editItemNotes, setEditItemNotes] = useState('');

  // Create / Edit Checklist Modal state (Synchronized with centralized create_checklist destination)
  const [formModalVisible, setFormModalVisibleState] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' | 'edit'

  const setFormModalVisible = useCallback(
    (nextVisible) => {
      const resolved = Boolean(nextVisible);
      setFormModalVisibleState(resolved);
      if (!resolved) {
        if (typeof onChangeCreateModalOpen === 'function') {
          onChangeCreateModalOpen(false);
        }
        if (typeof setContextCreateModalOpen === 'function') {
          setContextCreateModalOpen(false);
        }
      }
    },
    [onChangeCreateModalOpen, setContextCreateModalOpen]
  );
  const [editingChecklistId, setEditingChecklistId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('Release Readiness');
  const [formPriority, setFormPriority] = useState('High');
  const [formEnvironment, setFormEnvironment] = useState('Staging');
  const [formTargetRelease, setFormTargetRelease] = useState('');
  const [formProjectScope, setFormProjectScope] = useState('current'); // 'current' | 'workspace'
  const [formTemplateId, setFormTemplateId] = useState('none');
  const [formCustomItemsText, setFormCustomItemsText] = useState('');
  const [formError, setFormError] = useState(null);

  // Destructive Delete Confirmation Modal state
  const [deleteTargetChecklist, setDeleteTargetChecklist] = useState(null);

  // Promote Checklist to Project Modal state
  const [promoteModalVisible, setPromoteModalVisible] = useState(false);
  const [promoteSourceChecklist, setPromoteSourceChecklist] = useState(null);
  const [promoteTargetProjectId, setPromoteTargetProjectId] = useState('');
  const [promoteTargetProjectDetail, setPromoteTargetProjectDetail] =
    useState(null);
  const [isLoadingPromotePreview, setIsLoadingPromotePreview] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promoteProgressText, setPromoteProgressText] = useState('');
  const [promoteError, setPromoteError] = useState(null);
  const [promoteSuccessResult, setPromoteSuccessResult] = useState(null);

  useWorkspaceBackOverlay(() => {
    if (deleteTargetChecklist) {
      if (!busyMutation) setDeleteTargetChecklist(null);
      return true;
    }
    if (promoteModalVisible) {
      if (!isPromoting) setPromoteModalVisible(false);
      return true;
    }
    if (editingItem) {
      if (!busyMutation) setEditingItem(null);
      return true;
    }
    if (formModalVisible) {
      if (!busyMutation) setFormModalVisible(false);
      return true;
    }
    return false;
  });

  const loadGenerationRef = useRef(0);
  const mutationLockRef = useRef(false);
  const promoteLockRef = useRef(false);
  const detailScrollRef = useRef(null);
  const newItemTitleRef = useRef(null);
  const newItemNotesRef = useRef(null);
  const editItemTitleRef = useRef(null);
  const editItemNotesRef = useRef(null);
  const checklistFormScrollRef = useRef(null);
  const formTitleRef = useRef(null);
  const formDescRef = useRef(null);
  const formEnvRef = useRef(null);
  const formReleaseRef = useRef(null);
  const formCustomItemsRef = useRef(null);

  const scrollChecklistFormTo = useCallback((yOffset) => {
    setTimeout(() => {
      if (
        checklistFormScrollRef.current &&
        typeof checklistFormScrollRef.current.scrollTo === 'function'
      ) {
        checklistFormScrollRef.current.scrollTo({
          y: Math.max(0, yOffset),
          animated: true,
        });
      }
    }, 120);
  }, []);

  const syncChecklistsState = useCallback(
    (nextList, persistCache = false) => {
      const normalized = (Array.isArray(nextList) ? nextList : [])
        .map(normalizeChecklistRecord)
        .filter(Boolean);
      const owned = filterChecklistsForUser(normalized, currentUserId);
      setChecklistsState(owned);
      if (typeof setWorkspaceChecklists === 'function') {
        setWorkspaceChecklists(owned);
      }
      if (persistCache && currentUserId) {
        cacheChecklistsForUser(owned, currentUserId, {
          preservePending: true,
        }).catch(() => {});
      }
      return owned;
    },
    [currentUserId, setWorkspaceChecklists]
  );

  // Load checklists from backend `/api/checklists` with per-user cache & pending-queue merge
  const loadChecklists = useCallback(
    async ({ silent = false } = {}) => {
      const gen = ++loadGenerationRef.current;

      if (!currentUserId) {
        setChecklistsState([]);
        setActiveChecklistId(null);
        setErrorBanner(null);
        setAuthExpiredError(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorBanner(null);
      setAuthExpiredError(false);

      try {
        // Hydrate from per-user cache + pending queue first so UI responds immediately
        const cached = await getCachedChecklistsForUser(currentUserId);
        if (gen !== loadGenerationRef.current) return;

        const apiRes = await fetchChecklists({ userId: currentUserId });
        if (gen !== loadGenerationRef.current) return;

        if (apiRes.ok) {
          setIsFromOfflineCache(Boolean(apiRes.fromCache || apiRes.offlineFallback));
          syncChecklistsState(apiRes.checklists, false);
        } else if (apiRes.isUnauthorized || apiRes.status === 401) {
          setAuthExpiredError(true);
          setErrorBanner(
            'Your session has expired. Please sign in again to access your QA checklists.'
          );
          setChecklistsState([]);
        } else if (apiRes.isNetworkError || isOfflineMode) {
          setIsFromOfflineCache(true);
          syncChecklistsState(cached, false);
          if (cached.length === 0 && apiRes.error) {
            setErrorBanner(
              'Offline mode active: could not reach /api/checklists and no cached checklists were found.'
            );
          }
        } else {
          if (cached.length > 0) {
            setIsFromOfflineCache(true);
            syncChecklistsState(cached, false);
          }
          setErrorBanner(apiRes.error || 'Failed to load QA checklists.');
        }
      } catch (err) {
        if (gen !== loadGenerationRef.current) return;
        setErrorBanner(
          (err && err.message) || 'Unexpected error while loading QA checklists.'
        );
      } finally {
        if (gen === loadGenerationRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [currentUserId, isOfflineMode, syncChecklistsState]
  );

  useEffect(() => {
    loadChecklists();
  }, [loadChecklists]);

  // Subscribe to offline queue / sync engine events so pending -> syncing -> synced / conflict / failed transitions update immediately
  useEffect(() => {
    if (!currentUserId) return undefined;
    const unsubscribe = subscribeToSyncEvents((evt) => {
      if (
        evt &&
        (evt.entityType === 'checklist' ||
          evt.type === 'sync_started' ||
          evt.type === 'sync_completed' ||
          evt.type === 'conflict_resolved' ||
          evt.type === 'operation_discarded')
      ) {
        getCachedChecklistsForUser(currentUserId)
          .then((cached) => {
            syncChecklistsState(cached, false);
          })
          .catch(() => {});
      }
    });
    return () => {
      unsubscribe();
    };
  }, [currentUserId, syncChecklistsState]);

  // Keep local state synchronized if workspaceChecklists changes externally (e.g. Data Import / Reset)
  useEffect(() => {
    if (Array.isArray(workspaceChecklists)) {
      const owned = filterChecklistsForUser(workspaceChecklists, currentUserId);
      setChecklistsState(owned);
    }
  }, [workspaceChecklists, currentUserId]);

  // Adjust default scope filter when selectedProject changes
  useEffect(() => {
    if (!selectedProjectId && scopeFilter === 'project') {
      setScopeFilter('all');
    }
  }, [selectedProjectId, scopeFilter]);

  // Map queued checklist operations by checklistId for instant UI lookup
  const checklistQueueMap = useMemo(() => {
    const map = new Map();
    const ops = Array.isArray(syncStatus?.checklistOperations)
      ? syncStatus.checklistOperations
      : Array.isArray(syncStatus?.operations)
      ? syncStatus.operations.filter((o) => o && o.entityType === 'checklist')
      : [];
    ops.forEach((op) => {
      const cid = String(op.checklistId || op.entityId || '').trim();
      if (cid) {
        map.set(cid, op);
      }
    });
    return map;
  }, [syncStatus]);

  const checklistQueueCounts = useMemo(() => {
    const ops = Array.from(checklistQueueMap.values());
    let pending = 0;
    let syncing = 0;
    let conflict = 0;
    let failed = 0;
    ops.forEach((op) => {
      if (op.status === 'conflict' || op.requiresManualResolution) conflict += 1;
      else if (op.status === 'failed') failed += 1;
      else if (op.status === 'syncing' || syncStatus?.isSyncing) syncing += 1;
      else pending += 1;
    });
    return {
      total: ops.length,
      pending,
      syncing,
      conflict,
      failed,
    };
  }, [checklistQueueMap, syncStatus?.isSyncing]);

  // Scoped checklists (Project vs All Workspace)
  const scopedChecklists = useMemo(() => {
    const owned = filterChecklistsForUser(checklists, currentUserId);
    if (scopeFilter === 'project' && selectedProjectId) {
      return filterChecklistsByProject(owned, {
        projectId: selectedProjectId,
        sourceChecklistId: selectedProject?.sourceChecklistId || null,
        includeUnassigned: false,
      });
    }
    return owned;
  }, [checklists, currentUserId, scopeFilter, selectedProjectId, selectedProject]);

  // Filtered checklists based on search, status, and category
  const filteredChecklists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedChecklists.filter((chk) => {
      if (statusFilter !== 'All' && chk.status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== 'All' && chk.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;

      const titleMatch = (chk.title || '').toLowerCase().includes(q);
      const descMatch = (chk.description || '').toLowerCase().includes(q);
      const catMatch = (chk.category || '').toLowerCase().includes(q);
      const idMatch = (chk.id || '').toLowerCase().includes(q);
      const projMatch = (chk.projectName || '').toLowerCase().includes(q);
      const itemMatch = Array.isArray(chk.items)
        ? chk.items.some((it) => (it.title || '').toLowerCase().includes(q))
        : false;

      return (
        titleMatch || descMatch || catMatch || idMatch || projMatch || itemMatch
      );
    });
  }, [scopedChecklists, searchQuery, statusFilter, categoryFilter]);

  const summaryMetrics = useMemo(
    () => computeChecklistsSummaryMetrics(scopedChecklists),
    [scopedChecklists]
  );

  const activeChecklist = useMemo(() => {
    if (!activeChecklistId) return null;
    return (
      checklists.find((c) => c.id === activeChecklistId) || null
    );
  }, [checklists, activeChecklistId]);

  const filteredActiveItems = useMemo(() => {
    if (!activeChecklist || !Array.isArray(activeChecklist.items)) return [];
    return activeChecklist.items.filter((it) => {
      if (itemFilterMode === 'completed') return Boolean(it.completed);
      if (itemFilterMode === 'pending') return !it.completed;
      return true;
    });
  }, [activeChecklist, itemFilterMode]);

  const getChecklistSyncInfo = useCallback(
    (chk) => {
      if (!chk) {
        return {
          state: 'synced',
          label: 'Synced',
          bg: colors.successSoft,
          fg: colors.success,
          op: null,
        };
      }
      const queuedOp = checklistQueueMap.get(String(chk.id || '')) || null;
      const rawStatus =
        (queuedOp && queuedOp.status) ||
        chk._syncStatus ||
        (chk._pendingSync || chk._pendingCreation ? 'pending' : 'synced');

      if (
        rawStatus === 'conflict' ||
        (queuedOp && queuedOp.requiresManualResolution)
      ) {
        return {
          state: 'conflict',
          label: 'Conflict (409)',
          bg: colors.dangerSoft,
          fg: colors.danger,
          op: queuedOp,
          opId: (queuedOp && queuedOp.id) || chk._syncOpId || null,
          error:
            (queuedOp && queuedOp.lastError) ||
            chk._syncError ||
            'Checklist was modified on the server while you had pending changes.',
          conflictDetails:
            (queuedOp && queuedOp.conflictDetails) ||
            chk._conflictDetails ||
            null,
        };
      }

      if (rawStatus === 'failed') {
        return {
          state: 'failed',
          label: 'Sync Failed',
          bg: colors.dangerSoft,
          fg: colors.danger,
          op: queuedOp,
          opId: (queuedOp && queuedOp.id) || chk._syncOpId || null,
          error:
            (queuedOp && queuedOp.lastError) ||
            chk._syncError ||
            'Synchronization failed. Tap Retry to attempt sync again.',
        };
      }

      if (
        rawStatus === 'syncing' ||
        (syncStatus?.isSyncing &&
          (queuedOp || chk._pendingSync || chk._pendingCreation))
      ) {
        return {
          state: 'syncing',
          label: 'Syncing...',
          bg: colors.infoSoft,
          fg: colors.primary,
          op: queuedOp,
          opId: (queuedOp && queuedOp.id) || chk._syncOpId || null,
        };
      }

      if (
        rawStatus === 'pending' ||
        queuedOp ||
        chk._pendingSync ||
        chk._pendingCreation
      ) {
        const isCreate =
          Boolean(chk._pendingCreation) ||
          Boolean(queuedOp && queuedOp.operationType === 'CREATE');
        return {
          state: 'pending',
          label: isCreate ? 'Queued Create' : 'Pending Sync',
          bg: colors.warningSoft,
          fg: colors.warning,
          op: queuedOp,
          opId: (queuedOp && queuedOp.id) || chk._syncOpId || null,
        };
      }

      return {
        state: 'synced',
        label: 'Synced',
        bg: colors.successSoft,
        fg: colors.success,
        op: null,
        opId: null,
      };
    },
    [checklistQueueMap, colors, syncStatus?.isSyncing]
  );

  // Refresh a single checklist from `GET /api/checklists/:id` when opened
  const handleSelectChecklist = async (checklist) => {
    if (!checklist || !checklist.id) return;
    setActiveChecklistId(checklist.id);
    setItemFilterMode('all');
    setNewItemTitle('');
    setNewItemNotes('');

    if (!isOfflineMode && currentUserId) {
      const detailRes = await fetchChecklistById(checklist.id, {
        userId: currentUserId,
      });
      if (detailRes.ok && detailRes.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === detailRes.checklist.id ? detailRes.checklist : c
          ),
          false
        );
      }
    }
  };

  const handleResolveChecklistConflict = async (opId, resolution) => {
    if (!opId || !currentUserId || busyMutation) return;
    setBusyMutation(true);
    try {
      const res = await resolveSyncConflict(opId, resolution);
      const cached = await getCachedChecklistsForUser(currentUserId);
      syncChecklistsState(cached, false);
      if (res && res.ok) {
        if (showToast) {
          showToast(
            resolution === 'keep_server'
              ? 'Applied latest server version.'
              : resolution === 'merge'
              ? 'Merged offline checklist changes with server.'
              : 'Applied local checklist changes.',
            'success'
          );
        }
      } else if (res && res.error) {
        setErrorBanner(res.error);
      }
    } finally {
      setBusyMutation(false);
    }
  };

  const handleRetryChecklistOp = async (opId) => {
    if (!currentUserId || busyMutation) return;
    setBusyMutation(true);
    try {
      if (opId) {
        await retryProjectOperation(opId, currentUserId);
      } else if (typeof retryFailedSync === 'function') {
        await retryFailedSync();
      }
      const cached = await getCachedChecklistsForUser(currentUserId);
      syncChecklistsState(cached, false);
    } finally {
      setBusyMutation(false);
    }
  };

  // Open Create Checklist modal
  const openCreateModal = (presetTemplateId = 'none') => {
    const preset =
      CHECKLIST_STARTER_TEMPLATES.find((t) => t.id === presetTemplateId) || null;
    setFormMode('create');
    setEditingChecklistId(null);
    setFormTitle(preset ? preset.name : '');
    setFormDescription(preset ? preset.description : '');
    setFormCategory(preset ? preset.category : 'Release Readiness');
    setFormPriority(preset ? preset.priority : 'High');
    setFormEnvironment(
      (selectedProject && selectedProject.environment) || 'Staging'
    );
    setFormTargetRelease(
      (selectedProject && selectedProject.version) || 'v1.0.0'
    );
    setFormProjectScope(selectedProjectId ? 'current' : 'workspace');
    setFormTemplateId(preset ? preset.id : 'none');
    setFormCustomItemsText('');
    setFormError(null);
    setFormModalVisibleState(true);
    if (typeof onChangeCreateModalOpen === 'function') {
      onChangeCreateModalOpen(true);
    }
    if (typeof setContextCreateModalOpen === 'function') {
      setContextCreateModalOpen(true);
    }
  };

  const resolvedCreateModalRequest =
    controlledCreateModalOpen !== undefined
      ? controlledCreateModalOpen
      : Boolean(contextCreateModalOpen);
  const resolvedTemplateRequest =
    initialTemplateId !== undefined
      ? initialTemplateId
      : contextCreateTemplateId || 'none';

  useEffect(() => {
    if (resolvedCreateModalRequest && !formModalVisible) {
      openCreateModal(resolvedTemplateRequest);
      if (typeof onResetTemplateId === 'function') {
        onResetTemplateId();
      }
      if (typeof setContextCreateTemplateId === 'function') {
        setContextCreateTemplateId('none');
      }
    } else if (
      !resolvedCreateModalRequest &&
      formModalVisible &&
      formMode === 'create'
    ) {
      setFormModalVisibleState(false);
    }
  }, [resolvedCreateModalRequest, resolvedTemplateRequest]);

  // Open Edit Checklist modal
  const openEditModal = (checklist) => {
    if (!checklist) return;
    setFormMode('edit');
    setEditingChecklistId(checklist.id);
    setFormTitle(checklist.title || '');
    setFormDescription(checklist.description || '');
    setFormCategory(checklist.category || 'General QA');
    setFormPriority(checklist.priority || 'Medium');
    setFormEnvironment(checklist.environment || 'Staging');
    setFormTargetRelease(checklist.targetRelease || '');
    setFormProjectScope(checklist.projectId ? 'current' : 'workspace');
    setFormTemplateId('none');
    setFormCustomItemsText('');
    setFormError(null);
    setFormModalVisible(true);
  };

  const handleSelectStarterTemplate = (templateId) => {
    setFormTemplateId(templateId);
    const tpl = CHECKLIST_STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      if (!formTitle.trim()) setFormTitle(tpl.name);
      if (!formDescription.trim()) setFormDescription(tpl.description);
      setFormCategory(tpl.category);
      setFormPriority(tpl.priority);
    }
  };

  // Handle Create or Edit Checklist submission
  const handleSaveChecklistForm = async () => {
    if (mutationLockRef.current || busyMutation) return;

    const cleanTitle = formTitle.trim();
    if (!cleanTitle) {
      setFormError('Checklist title is required.');
      return;
    }
    if (cleanTitle.length > 200) {
      setFormError('Checklist title cannot exceed 200 characters.');
      return;
    }

    Keyboard.dismiss();
    mutationLockRef.current = true;
    setBusyMutation(true);
    setFormError(null);

    try {
      const existingChecklist =
        formMode === 'edit' && editingChecklistId
          ? checklists.find((c) => c.id === editingChecklistId)
          : null;
      const targetProjId =
        formProjectScope === 'current'
          ? selectedProjectId ||
            (existingChecklist && existingChecklist.projectId) ||
            null
          : null;
      const targetProjName =
        formProjectScope === 'current'
          ? (selectedProject && selectedProject.name) ||
            (existingChecklist && existingChecklist.projectName) ||
            ''
          : '';

      if (formMode === 'create') {
        const selectedTemplate = CHECKLIST_STARTER_TEMPLATES.find(
          (t) => t.id === formTemplateId
        );
        const templateItems = selectedTemplate
          ? selectedTemplate.items.map((it, idx) => ({
              id: `chk_item_tpl_${Date.now()}_${idx + 1}`,
              title: it.title,
              category: it.category || formCategory,
              priority: it.priority || formPriority,
              completed: false,
            }))
          : [];

        const customLines = formCustomItemsText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line, idx) => ({
            id: `chk_item_cust_${Date.now()}_${idx + 1}`,
            title: line,
            category: formCategory,
            priority: formPriority,
            completed: false,
          }));

        const initialItems = [...templateItems, ...customLines];

        const createPayload = {
          title: cleanTitle,
          description: formDescription.trim(),
          category: formCategory,
          priority: formPriority,
          environment: formEnvironment.trim() || 'Staging',
          targetRelease: formTargetRelease.trim(),
          projectId: targetProjId,
          projectName: targetProjName,
          items: initialItems,
        };

        const res = await createChecklist(createPayload, {
          userId: currentUserId,
        });

        if (res.ok && res.checklist) {
          const nextList = [
            res.checklist,
            ...checklists.filter((c) => c.id !== res.checklist.id),
          ];
          syncChecklistsState(nextList, false);
          if (res.queuedOffline) {
            setIsFromOfflineCache(true);
          }
          setFormModalVisible(false);
          setActiveChecklistId(res.checklist.id);
          if (showToast) {
            showToast(
              res.queuedOffline
                ? `Queued "${res.checklist.title}" for sync when online.`
                : `Created checklist "${res.checklist.title}".`,
              res.queuedOffline ? 'info' : 'success'
            );
          }
        } else {
          setFormError(res.error || 'Failed to create checklist.');
        }
      } else if (formMode === 'edit' && editingChecklistId) {
        const existing = checklists.find((c) => c.id === editingChecklistId);
        const updates = {
          title: cleanTitle,
          description: formDescription.trim(),
          category: formCategory,
          priority: formPriority,
          environment: formEnvironment.trim() || 'Staging',
          targetRelease: formTargetRelease.trim(),
          projectId: targetProjId,
          projectName: targetProjName,
          items: existing?.items || [],
          expectedUpdatedAt:
            existing?._serverUpdatedAt || existing?.updatedAt || undefined,
        };

        const res = await updateChecklist(editingChecklistId, updates, {
          userId: currentUserId,
          existingChecklist: existing,
        });

        if (res.ok && res.checklist) {
          const nextList = checklists.map((c) =>
            c.id === editingChecklistId ? { ...c, ...res.checklist } : c
          );
          syncChecklistsState(nextList, false);
          if (res.queuedOffline) {
            setIsFromOfflineCache(true);
          }
          setFormModalVisible(false);
          if (showToast) {
            showToast(
              res.queuedOffline
                ? `Queued changes to "${res.checklist.title}" for sync.`
                : `Updated checklist "${res.checklist.title}".`,
              res.queuedOffline ? 'info' : 'success'
            );
          }
        } else if (res.isConflict) {
          setFormError(
            'Conflict detected (HTTP 409): This checklist was modified on the server. Close this dialog to review conflict resolution options.'
          );
        } else {
          setFormError(res.error || 'Failed to update checklist.');
        }
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

  // Confirm and execute Checklist Deletion
  const handleConfirmDeleteChecklist = async () => {
    if (!deleteTargetChecklist || mutationLockRef.current || busyMutation) return;

    const targetId = deleteTargetChecklist.id;
    const targetTitle = deleteTargetChecklist.title;
    mutationLockRef.current = true;
    setBusyMutation(true);

    try {
      const res = await deleteChecklist(targetId, { userId: currentUserId });
      if (res.ok || res.status === 404) {
        const nextList = checklists.filter((c) => c.id !== targetId);
        syncChecklistsState(nextList, false);
        if (activeChecklistId === targetId) {
          setActiveChecklistId(null);
        }
        setDeleteTargetChecklist(null);
        if (showToast) {
          showToast(
            res.queuedOffline
              ? res.cancelledOut
                ? `Removed offline draft "${targetTitle}".`
                : `Queued deletion of "${targetTitle}" for sync.`
              : `Deleted checklist "${targetTitle}".`,
            'info'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to delete checklist.');
        setDeleteTargetChecklist(null);
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

  // Toggle single checklist item completion
  const handleToggleItem = async (item) => {
    if (!activeChecklist || !item || busyItemId || mutationLockRef.current) return;

    setBusyItemId(item.id);
    mutationLockRef.current = true;

    const nextCompleted = !item.completed;

    try {
      const res = await toggleChecklistItemCompletion(
        activeChecklist,
        item.id,
        nextCompleted,
        { userId: currentUserId }
      );

      if (res.ok && res.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.checklist : c
          ),
          false
        );
        if (res.queuedOffline) {
          setIsFromOfflineCache(true);
        }
      } else if (res.isConflict) {
        if (showToast) {
          showToast(
            'Conflict (409): Checklist was updated on the server. Review resolution options.',
            'warning'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to update checklist item.');
      }
    } finally {
      setBusyItemId(null);
      mutationLockRef.current = false;
    }
  };

  // Add new item to active checklist
  const handleAddNewItem = async () => {
    if (!activeChecklist || mutationLockRef.current || busyMutation) return;
    const cleanTitle = newItemTitle.trim();
    if (!cleanTitle) {
      if (showToast) {
        showToast('Enter a checklist item title first.', 'warning');
      }
      return;
    }

    Keyboard.dismiss();
    mutationLockRef.current = true;
    setBusyMutation(true);

    const newItemObj = {
      id: `chk_item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      priority: newItemPriority,
      category: activeChecklist.category || 'General QA',
      notes: newItemNotes.trim(),
      completed: false,
    };

    try {
      const res = await addChecklistItem(activeChecklist, newItemObj, {
        userId: currentUserId,
      });

      if (res.ok && res.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.checklist : c
          ),
          false
        );
        setNewItemTitle('');
        setNewItemNotes('');
        if (res.queuedOffline) {
          setIsFromOfflineCache(true);
        }
        if (showToast) {
          showToast(
            res.queuedOffline
              ? 'Item queued for sync when online.'
              : 'Checklist item added.',
            res.queuedOffline ? 'info' : 'success'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to add checklist item.');
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

  // Open Edit Item modal
  const openEditItemModal = (item) => {
    if (!item) return;
    setEditingItem(item);
    setEditItemTitle(item.title || '');
    setEditItemPriority(item.priority || 'Medium');
    setEditItemCategory(item.category || 'General QA');
    setEditItemNotes(item.notes || '');
  };

  // Save edited item
  const handleSaveEditedItem = async () => {
    if (!activeChecklist || !editingItem || mutationLockRef.current || busyMutation) {
      return;
    }
    const cleanTitle = editItemTitle.trim();
    if (!cleanTitle) return;

    Keyboard.dismiss();
    mutationLockRef.current = true;
    setBusyMutation(true);

    try {
      const itemUpdates = {
        title: cleanTitle,
        priority: editItemPriority,
        category: editItemCategory,
        notes: editItemNotes.trim(),
      };

      const res = await updateChecklistItem(
        activeChecklist,
        editingItem.id,
        itemUpdates,
        { userId: currentUserId }
      );

      if (res.ok && res.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.checklist : c
          ),
          false
        );
        setEditingItem(null);
        if (res.queuedOffline) {
          setIsFromOfflineCache(true);
        }
        if (showToast) {
          showToast(
            res.queuedOffline
              ? 'Step update queued for sync.'
              : 'Updated checklist item.',
            res.queuedOffline ? 'info' : 'success'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to update checklist item.');
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

  // Delete an item from active checklist
  const handleDeleteItem = async (itemId) => {
    if (!activeChecklist || !itemId || mutationLockRef.current || busyMutation) return;

    mutationLockRef.current = true;
    setBusyItemId(itemId);

    try {
      const res = await deleteChecklistItem(activeChecklist, itemId, {
        userId: currentUserId,
      });

      if (res.ok && res.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.checklist : c
          ),
          false
        );
        if (res.queuedOffline) {
          setIsFromOfflineCache(true);
        }
        if (showToast) {
          showToast(
            res.queuedOffline
              ? 'Item removal queued for sync.'
              : 'Removed checklist item.',
            'info'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to delete checklist item.');
      }
    } finally {
      mutationLockRef.current = false;
      setBusyItemId(null);
    }
  };

  // Mark all items completed or uncompleted
  const handleBulkMarkItems = async (completed) => {
    if (!activeChecklist || mutationLockRef.current || busyMutation) return;
    if (!activeChecklist.items || activeChecklist.items.length === 0) return;

    mutationLockRef.current = true;
    setBusyMutation(true);

    try {
      const res = await markAllChecklistItems(activeChecklist, completed, {
        userId: currentUserId,
      });

      if (res.ok && res.checklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.checklist : c
          ),
          false
        );
        if (res.queuedOffline) {
          setIsFromOfflineCache(true);
        }
        if (showToast) {
          showToast(
            completed
              ? 'All checklist items marked Complete.'
              : 'All checklist items reset to Pending.',
            res.queuedOffline ? 'info' : 'success'
          );
        }
      } else {
        setErrorBanner(res.error || 'Failed to update checklist items.');
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

  // ============================================================================
  // CHECKLIST-TO-PROJECT PROMOTION WORKFLOW
  // ============================================================================
  const availableProjects = useMemo(
    () => (Array.isArray(projects) ? projects.filter((p) => p && (p.id || p._id)) : []),
    [projects]
  );

  // Resolve target project object for preview
  const resolvedPromoteTargetProject = useMemo(() => {
    if (!promoteTargetProjectId) return null;
    if (
      promoteTargetProjectDetail &&
      String(promoteTargetProjectDetail.id || promoteTargetProjectDetail._id) ===
        String(promoteTargetProjectId)
    ) {
      return promoteTargetProjectDetail;
    }
    return (
      availableProjects.find(
        (p) => String(p.id || p._id) === String(promoteTargetProjectId)
      ) || null
    );
  }, [
    promoteTargetProjectId,
    promoteTargetProjectDetail,
    availableProjects,
  ]);

  // Live deterministic promotion preview for confirmation modal
  const promotionPreview = useMemo(() => {
    if (!promoteSourceChecklist || !resolvedPromoteTargetProject) {
      return null;
    }
    return buildChecklistPromotionPreview(
      promoteSourceChecklist,
      resolvedPromoteTargetProject
    );
  }, [promoteSourceChecklist, resolvedPromoteTargetProject]);

  // Load full project details (suites/phases) when destination project selection changes
  useEffect(() => {
    let active = true;
    if (!promoteModalVisible || !promoteTargetProjectId) {
      setPromoteTargetProjectDetail(null);
      setIsLoadingPromotePreview(false);
      return () => {
        active = false;
      };
    }

    const baseProj = availableProjects.find(
      (p) => String(p.id || p._id) === String(promoteTargetProjectId)
    );
    if (baseProj) {
      setPromoteTargetProjectDetail(baseProj);
    }

    if (typeof getProject === 'function' && !isOfflineMode) {
      setIsLoadingPromotePreview(true);
      getProject(promoteTargetProjectId)
        .then((res) => {
          if (!active) return;
          if (res && res.ok && res.project) {
            setPromoteTargetProjectDetail(res.project);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) {
            setIsLoadingPromotePreview(false);
          }
        });
    }

    return () => {
      active = false;
    };
  }, [
    promoteModalVisible,
    promoteTargetProjectId,
    availableProjects,
    getProject,
    isOfflineMode,
  ]);

  const openPromoteModal = useCallback(
    (checklist) => {
      if (!checklist) return;
      const targetChecklist =
        activeChecklist && String(activeChecklist.id) === String(checklist.id)
          ? activeChecklist
          : checklist;

      setPromoteSourceChecklist(targetChecklist);
      setPromoteError(null);
      setPromoteSuccessResult(null);
      setPromoteProgressText('');

      // Default destination project: checklist's linked project -> active selected project -> first available project
      const linkedId = targetChecklist.projectId
        ? String(targetChecklist.projectId).trim()
        : '';
      const hasLinked =
        linkedId &&
        availableProjects.some(
          (p) => String(p.id || p._id) === linkedId
        );
      const hasSelected =
        selectedProjectId &&
        availableProjects.some(
          (p) => String(p.id || p._id) === selectedProjectId
        );

      const initialTargetId = hasLinked
        ? linkedId
        : hasSelected
        ? selectedProjectId
        : availableProjects.length > 0
        ? String(availableProjects[0].id || availableProjects[0]._id)
        : '';

      setPromoteTargetProjectId(initialTargetId);
      setPromoteModalVisible(true);
    },
    [activeChecklist, availableProjects, selectedProjectId]
  );

  const closePromoteModal = useCallback(() => {
    if (isPromoting) return;
    setPromoteModalVisible(false);
    setPromoteSourceChecklist(null);
    setPromoteError(null);
    setPromoteSuccessResult(null);
    setPromoteProgressText('');
  }, [isPromoting]);

  const handleSelectPromoteProject = useCallback((projectId) => {
    if (!projectId) return;
    setPromoteTargetProjectId(String(projectId));
    setPromoteError(null);
    setPromoteSuccessResult(null);
  }, []);

  const handleConfirmPromoteChecklist = useCallback(async () => {
    if (
      !promoteSourceChecklist ||
      !promoteTargetProjectId ||
      promoteLockRef.current ||
      isPromoting
    ) {
      return;
    }

    promoteLockRef.current = true;
    setIsPromoting(true);
    setPromoteError(null);
    setPromoteProgressText('Validating checklist and destination project...');

    try {
      const targetProj =
        resolvedPromoteTargetProject || promoteTargetProjectId;

      const res = await promoteChecklistToProject(
        promoteSourceChecklist,
        targetProj,
        {
          userId: currentUserId,
          updateProjectDataFn:
            typeof updateProjectData === 'function' ? updateProjectData : undefined,
          onProgress: (stageText) => {
            setPromoteProgressText(stageText);
          },
        }
      );

      if (res.ok && res.project) {
        setPromoteTargetProjectDetail(res.project);
        setPromoteSuccessResult({
          project: res.project,
          summary: res.summary || (res.preview && res.preview.stats) || {},
          preview: res.preview,
          queuedOffline: Boolean(res.queuedOffline),
        });
        setPromoteProgressText('');

        // Refresh projects list in background when online so counts & suites stay in sync everywhere
        if (typeof refreshProjects === 'function' && !res.queuedOffline) {
          refreshProjects().catch(() => {});
        }
        if (
          typeof reloadProjectDataFromBackend === 'function' &&
          String(selectedProjectId) === String(res.project.id) &&
          !res.queuedOffline
        ) {
          reloadProjectDataFromBackend(res.project.id).catch(() => {});
        }

        if (showToast) {
          const addedCount =
            (res.summary && res.summary.createdCaseCount) || 0;
          showToast(
            res.queuedOffline
              ? `Promoted "${promoteSourceChecklist.title}" to "${res.project.name}" (queued for sync).`
              : `Promoted "${promoteSourceChecklist.title}" to "${res.project.name}" (+${addedCount} test case${
                  addedCount === 1 ? '' : 's'
                }).`,
            res.queuedOffline ? 'info' : 'success'
          );
        }
      } else {
        setPromoteError(
          res.error ||
            'Failed to promote checklist to the destination project. Please try again.'
        );
        if (showToast && res.alreadyPromoted) {
          showToast(
            res.error ||
              'This checklist has already been promoted to the selected project.',
            'warning'
          );
        }
      }
    } catch (err) {
      setPromoteError(
        (err && err.message) ||
          'An unexpected error occurred while promoting the checklist.'
      );
    } finally {
      promoteLockRef.current = false;
      setIsPromoting(false);
    }
  }, [
    promoteSourceChecklist,
    promoteTargetProjectId,
    isPromoting,
    resolvedPromoteTargetProject,
    currentUserId,
    updateProjectData,
    refreshProjects,
    reloadProjectDataFromBackend,
    selectedProjectId,
    showToast,
  ]);

  const handleOpenPromotedProjectTestCases = useCallback(async () => {
    const targetId =
      (promoteSuccessResult &&
        promoteSuccessResult.project &&
        promoteSuccessResult.project.id) ||
      promoteTargetProjectId;
    if (!targetId) return;

    setPromoteModalVisible(false);
    setPromoteSuccessResult(null);
    setPromoteError(null);

    if (typeof selectProject === 'function') {
      await selectProject(targetId);
    }
    if (typeof openWorkspace === 'function') {
      openWorkspace('testcases');
    } else if (typeof setActiveTab === 'function') {
      setActiveTab('testcases');
    }
  }, [
    promoteSuccessResult,
    promoteTargetProjectId,
    selectProject,
    openWorkspace,
    setActiveTab,
  ]);

  const getPriorityBadgeColors = (priority) => {
    switch (priority) {
      case 'Critical':
        return { bg: colors.dangerSoft, fg: colors.danger };
      case 'High':
        return { bg: colors.warningSoft, fg: colors.warning };
      case 'Low':
        return { bg: colors.untestedSoft, fg: colors.textMuted };
      default:
        return { bg: colors.infoSoft, fg: colors.info };
    }
  };

  const getStatusBadgeColors = (status) => {
    switch (status) {
      case 'Completed':
        return { bg: colors.successSoft, fg: colors.success };
      case 'In Progress':
        return { bg: colors.infoSoft, fg: colors.primary };
      case 'Archived':
        return { bg: colors.untestedSoft, fg: colors.textMuted };
      default:
        return { bg: colors.warningSoft, fg: colors.warning };
    }
  };

  // ============================================================================
  // RENDER: ACTIVE CHECKLIST INTERACTIVE DETAIL VIEW
  // ============================================================================
  if (activeChecklist) {
    const statusPalette = getStatusBadgeColors(activeChecklist.status);
    const priorityPalette = getPriorityBadgeColors(activeChecklist.priority);
    const activeSyncInfo = getChecklistSyncInfo(activeChecklist);
    const linkedProjectObj = activeChecklist.projectId
      ? projects.find(
          (p) => String(p.id || p._id) === String(activeChecklist.projectId)
        )
      : null;
    const projectLabel =
      (linkedProjectObj && linkedProjectObj.name) ||
      activeChecklist.projectName ||
      (activeChecklist.projectId ? `Project ${activeChecklist.projectId}` : 'Workspace-Wide');

    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 76 : 16}
      >
        <ScrollView
          ref={detailScrollRef}
          contentContainerStyle={[
            styles.content,
            embedded && styles.contentEmbedded,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Back Bar & Detail Actions */}
          <View
            style={[
              styles.detailTopBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Pressable
              onPress={() => setActiveChecklistId(null)}
              accessibilityRole="button"
              accessibilityLabel="Back to all checklists"
              style={[
                styles.backBtn,
                { backgroundColor: colors.background, borderColor: colors.borderStrong },
              ]}
            >
              <VectorIcon name="chevron-left" size={16} color={colors.text} />
              <Text style={[styles.backBtnText, { color: colors.text }]}>
                All Checklists
              </Text>
            </Pressable>

            <View style={styles.detailTopActions}>
              <Pressable
                onPress={() => openPromoteModal(activeChecklist)}
                disabled={isPromoting}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(isPromoting) }}
                accessibilityLabel="Promote checklist to project"
                style={[
                  styles.smallActionBtn,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <VectorIcon
                  name="layers"
                  size={14}
                  color={colors.textOnPrimary}
                />
                <Text
                  style={[
                    styles.smallActionBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Promote to Project
                </Text>
              </Pressable>

              <Pressable
                onPress={() => openEditModal(activeChecklist)}
                accessibilityRole="button"
                accessibilityLabel="Edit checklist"
                style={[
                  styles.smallActionBtn,
                  { backgroundColor: colors.surfaceAccent, borderColor: colors.primary },
                ]}
              >
                <VectorIcon name="edit" size={14} color={colors.primary} />
                <Text style={[styles.smallActionBtnText, { color: colors.primary }]}>
                  Edit
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setDeleteTargetChecklist(activeChecklist)}
                accessibilityRole="button"
                accessibilityLabel="Delete checklist"
                style={[
                  styles.smallActionBtn,
                  { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
                ]}
              >
                <VectorIcon name="trash" size={14} color={colors.danger} />
                <Text style={[styles.smallActionBtnText, { color: colors.danger }]}>
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Active Checklist Conflict / Failed Sync Resolution Banner */}
          {activeSyncInfo.state === 'conflict' ? (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBannerTitle,
                  { color: colors.danger, marginBottom: 4 },
                ]}
              >
                Server Conflict Detected (HTTP 409)
              </Text>
              <Text
                style={[
                  styles.statusBannerText,
                  { color: colors.text, marginBottom: 10 },
                ]}
              >
                {activeSyncInfo.error ||
                  'This checklist was modified on the server while you had unsynchronized offline changes. Your local edits are preserved.'}
              </Text>
              <View style={styles.bulkActionsRow}>
                <Pressable
                  onPress={() =>
                    handleResolveChecklistConflict(activeSyncInfo.opId, 'merge')
                  }
                  disabled={busyMutation || !activeSyncInfo.opId}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: Boolean(busyMutation || !activeSyncInfo.opId),
                  }}
                  accessibilityLabel="Merge and sync checklist conflict"
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Merge & Sync
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    handleResolveChecklistConflict(
                      activeSyncInfo.opId,
                      'keep_local'
                    )
                  }
                  disabled={busyMutation || !activeSyncInfo.opId}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: Boolean(busyMutation || !activeSyncInfo.opId),
                  }}
                  accessibilityLabel="Keep local checklist version"
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[styles.secondaryBtnText, { color: colors.primary }]}
                  >
                    Keep Local
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    handleResolveChecklistConflict(
                      activeSyncInfo.opId,
                      'keep_server'
                    )
                  }
                  disabled={busyMutation || !activeSyncInfo.opId}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: Boolean(busyMutation || !activeSyncInfo.opId),
                  }}
                  accessibilityLabel="Use server checklist version"
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <Text
                    style={[styles.secondaryBtnText, { color: colors.text }]}
                  >
                    Use Server Version
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : activeSyncInfo.state === 'failed' ? (
            <View
              style={[
                styles.statusBanner,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.statusBannerTitle, { color: colors.danger }]}
                >
                  Checklist Synchronization Failed
                </Text>
                <Text
                  style={[
                    styles.statusBannerText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {activeSyncInfo.error}
                </Text>
              </View>
              <Pressable
                onPress={() => handleRetryChecklistOp(activeSyncInfo.opId)}
                disabled={busyMutation}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(busyMutation) }}
                accessibilityLabel="Retry checklist sync"
                style={[
                  styles.retryBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.retryBtnText, { color: colors.danger }]}>
                  Retry Sync
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Checklist Header & Progress Summary Card */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: statusPalette.bg },
                ]}
              >
                <Text style={[styles.badgeText, { color: statusPalette.fg }]}>
                  {activeChecklist.status}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: priorityPalette.bg },
                ]}
              >
                <Text style={[styles.badgeText, { color: priorityPalette.fg }]}>
                  {activeChecklist.priority} Priority
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                  {activeChecklist.category}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: activeSyncInfo.bg },
                ]}
              >
                <Text style={[styles.badgeText, { color: activeSyncInfo.fg }]}>
                  {activeSyncInfo.label}
                </Text>
              </View>
            </View>

            <Text style={[styles.detailTitle, { color: colors.text }]}>
              {activeChecklist.title}
            </Text>

            {activeChecklist.description ? (
              <Text style={[styles.detailDesc, { color: colors.textSecondary }]}>
                {activeChecklist.description}
              </Text>
            ) : null}

            <Text
              style={[
                styles.metaLine,
                { color: colors.textMuted, fontFamily: monoFontFamily },
              ]}
            >
              Scope: {projectLabel} · Env: {activeChecklist.environment || 'Staging'}
              {activeChecklist.targetRelease
                ? ` · Release: ${activeChecklist.targetRelease}`
                : ''}
            </Text>

            {/* Progress Bar */}
            <View style={styles.progressSection}>
              <View style={styles.progressHeaderRow}>
                <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                  Completion Progress ({activeChecklist.completedItems} of{' '}
                  {activeChecklist.totalItems} items)
                </Text>
                <Text
                  style={[
                    styles.progressPercent,
                    {
                      color:
                        activeChecklist.completionRate === 100
                          ? colors.success
                          : colors.primary,
                      fontFamily: monoFontFamily,
                    },
                  ]}
                >
                  {activeChecklist.completionRate}%
                </Text>
              </View>

              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, Math.max(0, activeChecklist.completionRate))}%`,
                      backgroundColor:
                        activeChecklist.completionRate === 100
                          ? colors.success
                          : colors.primary,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Bulk Completion Controls */}
            {activeChecklist.items.length > 0 ? (
              <View style={styles.bulkActionsRow}>
                <Pressable
                  onPress={() => handleBulkMarkItems(true)}
                  disabled={
                    busyMutation ||
                    activeChecklist.completedItems === activeChecklist.totalItems
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: Boolean(
                      busyMutation ||
                        activeChecklist.completedItems ===
                          activeChecklist.totalItems
                    ),
                  }}
                  accessibilityLabel="Mark all checklist steps complete"
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.successSoft,
                      borderColor: colors.success,
                      opacity:
                        busyMutation ||
                        activeChecklist.completedItems === activeChecklist.totalItems
                          ? 0.5
                          : 1,
                    },
                  ]}
                >
                  <VectorIcon name="check" size={14} color={colors.success} />
                  <Text style={[styles.secondaryBtnText, { color: colors.success }]}>
                    Mark All Complete
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => handleBulkMarkItems(false)}
                  disabled={busyMutation || activeChecklist.completedItems === 0}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: Boolean(
                      busyMutation || activeChecklist.completedItems === 0
                    ),
                  }}
                  accessibilityLabel="Reset all checklist steps to pending"
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.borderStrong,
                      opacity:
                        busyMutation || activeChecklist.completedItems === 0
                          ? 0.5
                          : 1,
                    },
                  ]}
                >
                  <VectorIcon name="refresh" size={14} color={colors.textSecondary} />
                  <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                    Reset All Pending
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Add New Checklist Item Composer */}
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
              ADD CHECKLIST VERIFICATION STEP
            </Text>
            <View style={styles.addItemRow}>
              <TextInput
                ref={newItemTitleRef}
                value={newItemTitle}
                onChangeText={setNewItemTitle}
                placeholder="Enter verification step or QA check..."
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="New verification step title"
                returnKeyType="next"
                blurOnSubmit={false}
                onFocus={() => {
                  setTimeout(() => {
                    detailScrollRef.current?.scrollTo({
                      y: 260,
                      animated: true,
                    });
                  }, 120);
                }}
                onSubmitEditing={() => newItemNotesRef.current?.focus()}
                style={[
                  styles.addItemInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />
              <Pressable
                onPress={handleAddNewItem}
                disabled={busyMutation || !newItemTitle.trim()}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: Boolean(busyMutation || !newItemTitle.trim()),
                }}
                accessibilityLabel="Add verification step"
                style={[
                  styles.addItemSubmitBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: busyMutation || !newItemTitle.trim() ? 0.55 : 1,
                  },
                ]}
              >
                <VectorIcon name="plus" size={15} color={colors.textOnPrimary} />
                <Text
                  style={[
                    styles.addItemSubmitText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Add Step
                </Text>
              </Pressable>
            </View>

            <View style={styles.itemMetaComposerRow}>
              <View
                style={styles.priorityPillsRow}
                accessibilityRole="radiogroup"
              >
                {CHECKLIST_PRIORITIES.map((prio) => {
                  const active = newItemPriority === prio;
                  return (
                    <Pressable
                      key={prio}
                      onPress={() => setNewItemPriority(prio)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      accessibilityLabel={`New step priority: ${prio}`}
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

              <TextInput
                ref={newItemNotesRef}
                value={newItemNotes}
                onChangeText={setNewItemNotes}
                placeholder="Optional verification note / expected outcome..."
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Optional verification note or expected outcome"
                returnKeyType="done"
                onFocus={() => {
                  setTimeout(() => {
                    detailScrollRef.current?.scrollTo({
                      y: 320,
                      animated: true,
                    });
                  }, 120);
                }}
                onSubmitEditing={handleAddNewItem}
                style={[
                  styles.itemNotesInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />
            </View>
          </View>

          {/* Checklist Items List & Filter Tabs */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.itemsHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Checklist Items ({filteredActiveItems.length})
              </Text>

              <View style={styles.itemFilterTabs} accessibilityRole="tablist">
                {[
                  { id: 'all', label: `All (${activeChecklist.totalItems})` },
                  { id: 'pending', label: `Pending (${activeChecklist.pendingItems})` },
                  {
                    id: 'completed',
                    label: `Done (${activeChecklist.completedItems})`,
                  },
                ].map((tab) => {
                  const active = itemFilterMode === tab.id;
                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setItemFilterMode(tab.id)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Filter steps: ${tab.label}`}
                      style={[
                        styles.itemFilterBtn,
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
                          styles.itemFilterBtnText,
                          {
                            color: active
                              ? colors.textOnPrimary
                              : colors.textSecondary,
                          },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {filteredActiveItems.length === 0 ? (
              <View style={styles.emptyItemsBox}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {activeChecklist.totalItems === 0
                    ? 'No items in this checklist yet'
                    : 'No items match the selected filter'}
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  {activeChecklist.totalItems === 0
                    ? 'Add verification steps above to start tracking completion progress.'
                    : 'Switch filter tabs to view all checklist steps.'}
                </Text>
              </View>
            ) : (
              <View style={styles.itemsList}>
                {filteredActiveItems.map((item, idx) => {
                  const isBusy = busyItemId === item.id;
                  const prioBadge = getPriorityBadgeColors(item.priority);
                  return (
                    <View
                      key={item.id || idx}
                      style={[
                        styles.itemRow,
                        {
                          backgroundColor: item.completed
                            ? colors.surfaceMuted
                            : colors.background,
                          borderColor: item.completed
                            ? colors.success
                            : colors.border,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={() => handleToggleItem(item)}
                        disabled={isBusy}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: Boolean(item.completed),
                          disabled: Boolean(isBusy),
                        }}
                        accessibilityLabel={`Mark step "${item.title}" as ${
                          item.completed ? 'incomplete' : 'completed'
                        }`}
                        style={[
                          styles.checkboxHitbox,
                          {
                            backgroundColor: item.completed
                              ? colors.success
                              : colors.surface,
                            borderColor: item.completed
                              ? colors.success
                              : colors.borderStrong,
                          },
                        ]}
                      >
                        {isBusy ? (
                          <ActivityIndicator
                            size="small"
                            color={
                              item.completed ? colors.textOnPrimary : colors.primary
                            }
                          />
                        ) : item.completed ? (
                          <VectorIcon
                            name="check"
                            size={14}
                            color={colors.textOnPrimary}
                          />
                        ) : null}
                      </Pressable>

                      <Pressable
                        onPress={() => handleToggleItem(item)}
                        disabled={isBusy}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: Boolean(isBusy) }}
                        accessibilityLabel={`Toggle checklist step "${item.title}", currently ${
                          item.completed ? 'completed' : 'pending'
                        }`}
                        style={styles.itemTextColumn}
                      >
                        <Text
                          style={[
                            styles.itemTitleText,
                            {
                              color: item.completed
                                ? colors.textMuted
                                : colors.text,
                              textDecorationLine: item.completed
                                ? 'line-through'
                                : 'none',
                            },
                          ]}
                        >
                          {item.title}
                        </Text>

                        {item.notes ? (
                          <Text
                            style={[
                              styles.itemNotesText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {item.notes}
                          </Text>
                        ) : null}

                        <View style={styles.itemMetaRow}>
                          <Text
                            style={[
                              styles.itemPriorityTag,
                              {
                                color: prioBadge.fg,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {item.priority}
                          </Text>
                          <Text
                            style={[
                              styles.itemCategoryTag,
                              { color: colors.textMuted },
                            ]}
                          >
                            · {item.category || 'General QA'}
                          </Text>
                          {item.completed && item.completedAt ? (
                            <Text
                              style={[
                                styles.itemCompletedTag,
                                {
                                  color: colors.success,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              · Done
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>

                      <View style={styles.itemRowActions}>
                        <Pressable
                          onPress={() => openEditItemModal(item)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit step ${item.title}`}
                          style={[
                            styles.iconBtn,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="edit"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </Pressable>

                        <Pressable
                          onPress={() => handleDeleteItem(item.id)}
                          disabled={isBusy}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: Boolean(isBusy) }}
                          accessibilityLabel={`Delete step ${item.title}`}
                          style={[
                            styles.iconBtn,
                            {
                              backgroundColor: colors.dangerSoft,
                              borderColor: colors.danger,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="trash"
                            size={14}
                            color={colors.danger}
                          />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Edit Checklist Item Modal */}
        <ChecklistEditItemModal
          editingItem={editingItem}
          setEditingItem={setEditingItem}
          editItemTitleRef={editItemTitleRef}
          editItemTitle={editItemTitle}
          setEditItemTitle={setEditItemTitle}
          editItemNotesRef={editItemNotesRef}
          editItemPriority={editItemPriority}
          setEditItemPriority={setEditItemPriority}
          editItemNotes={editItemNotes}
          setEditItemNotes={setEditItemNotes}
          handleSaveEditedItem={handleSaveEditedItem}
          busyMutation={busyMutation}
        />

        {/* Shared Create/Edit & Delete Modals */}
        {renderChecklistModals()}
      </KeyboardAvoidingView>
    );
  }

  // ============================================================================
  // HELPER: CREATE / EDIT & DELETE CONFIRMATION MODALS
  // ============================================================================
  function renderChecklistModals() {
    return (
      <>
        <ChecklistFormModal
          formModalVisible={formModalVisible}
          setFormModalVisible={setFormModalVisible}
          formMode={formMode}
          checklistFormScrollRef={checklistFormScrollRef}
          formError={formError}
          formTemplateId={formTemplateId}
          handleSelectStarterTemplate={handleSelectStarterTemplate}
          formTitleRef={formTitleRef}
          formTitle={formTitle}
          setFormTitle={setFormTitle}
          scrollChecklistFormTo={scrollChecklistFormTo}
          formDescRef={formDescRef}
          formDescription={formDescription}
          setFormDescription={setFormDescription}
          formCategory={formCategory}
          setFormCategory={setFormCategory}
          formPriority={formPriority}
          setFormPriority={setFormPriority}
          selectedProjectId={selectedProjectId}
          selectedProject={selectedProject}
          formProjectScope={formProjectScope}
          setFormProjectScope={setFormProjectScope}
          formEnvRef={formEnvRef}
          formEnvironment={formEnvironment}
          setFormEnvironment={setFormEnvironment}
          formReleaseRef={formReleaseRef}
          formTargetRelease={formTargetRelease}
          setFormTargetRelease={setFormTargetRelease}
          formCustomItemsRef={formCustomItemsRef}
          formCustomItemsText={formCustomItemsText}
          setFormCustomItemsText={setFormCustomItemsText}
          handleSaveChecklistForm={handleSaveChecklistForm}
          busyMutation={busyMutation}
        />

        <ChecklistDeleteModal
          deleteTargetChecklist={deleteTargetChecklist}
          setDeleteTargetChecklist={setDeleteTargetChecklist}
          handleConfirmDeleteChecklist={handleConfirmDeleteChecklist}
          busyMutation={busyMutation}
        />

        <ChecklistPromoteModal
          promoteModalVisible={promoteModalVisible}
          closePromoteModal={closePromoteModal}
          isPromoting={isPromoting}
          promoteSourceChecklist={promoteSourceChecklist}
          getPriorityBadgeColors={getPriorityBadgeColors}
          promoteSuccessResult={promoteSuccessResult}
          handleOpenPromotedProjectTestCases={handleOpenPromotedProjectTestCases}
          availableProjects={availableProjects}
          onBackToOverview={onBackToOverview}
          promoteTargetProjectId={promoteTargetProjectId}
          handleSelectPromoteProject={handleSelectPromoteProject}
          promotionPreview={promotionPreview}
          isLoadingPromotePreview={isLoadingPromotePreview}
          promoteProgressText={promoteProgressText}
          promoteError={promoteError}
          handleConfirmPromoteChecklist={handleConfirmPromoteChecklist}
        />
      </>
    );
  }

  // ============================================================================
  // RENDER: STANDALONE QA CHECKLISTS LIST SCREEN
  // ============================================================================
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          embedded && styles.contentEmbedded,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Module Header & Primary Actions */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerTextCol}>
              <Text
                style={[
                  styles.sectionKicker,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                STANDALONE QA CHECKLISTS MODULE · /API/CHECKLISTS
              </Text>
              <Text style={[styles.screenTitle, { color: colors.text }]}>
                QA Verification Checklists
              </Text>
              <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
                Create, execute, and track release readiness, smoke, and security
                checklists with real-time item progress.
              </Text>
            </View>

            <View style={styles.headerActionsCol}>
              {onBackToOverview ? (
                <Pressable
                  onPress={onBackToOverview}
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedProject ? 'Back to Overview' : 'Back to Projects'
                  }
                  style={[
                    styles.secondaryHeaderBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <VectorIcon name="chevron-left" size={14} color={colors.text} />
                  <Text style={[styles.secondaryHeaderBtnText, { color: colors.text }]}>
                    {selectedProject ? 'Overview' : 'Projects'}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => loadChecklists({ silent: true })}
                disabled={isLoading || isRefreshing}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: Boolean(isLoading || isRefreshing),
                }}
                accessibilityLabel="Refresh checklists"
                style={[
                  styles.secondaryHeaderBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <VectorIcon name="refresh" size={14} color={colors.primary} />
                <Text style={[styles.secondaryHeaderBtnText, { color: colors.text }]}>
                  {isRefreshing ? 'Syncing...' : 'Refresh'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => openCreateModal('none')}
                accessibilityRole="button"
                accessibilityLabel="Create New Checklist"
                style={[
                  styles.primaryHeaderBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <VectorIcon name="plus" size={14} color={colors.textOnPrimary} />
                <Text
                  style={[
                    styles.primaryHeaderBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  + New Checklist
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Scope Selector: Active Project vs All Workspace Checklists */}
          <View style={styles.scopeToggleRow} accessibilityRole="tablist">
            {selectedProjectId ? (
              <Pressable
                onPress={() => setScopeFilter('project')}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: scopeFilter === 'project' }}
                accessibilityLabel={`Project scope: ${
                  selectedProject?.name || 'Selected'
                }`}
                style={[
                  styles.scopeTab,
                  {
                    backgroundColor:
                      scopeFilter === 'project'
                        ? colors.primary
                        : colors.background,
                    borderColor:
                      scopeFilter === 'project' ? colors.primary : colors.border,
                  },
                ]}
              >
                <VectorIcon
                  name="folder"
                  size={14}
                  color={
                    scopeFilter === 'project'
                      ? colors.textOnPrimary
                      : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.scopeTabText,
                    {
                      color:
                        scopeFilter === 'project'
                          ? colors.textOnPrimary
                          : colors.text,
                    },
                  ]}
                >
                  Project: {selectedProject?.name || 'Selected'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setScopeFilter('all')}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: scopeFilter === 'all' }}
              accessibilityLabel={`All My Checklists (${checklists.length})`}
              style={[
                styles.scopeTab,
                {
                  backgroundColor:
                    scopeFilter === 'all' ? colors.primary : colors.background,
                  borderColor:
                    scopeFilter === 'all' ? colors.primary : colors.border,
                },
              ]}
            >
              <VectorIcon
                name="clipboard"
                size={14}
                color={
                  scopeFilter === 'all'
                    ? colors.textOnPrimary
                    : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.scopeTabText,
                  {
                    color:
                      scopeFilter === 'all'
                        ? colors.textOnPrimary
                        : colors.text,
                  },
                ]}
              >
                All My Checklists ({checklists.length})
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Offline / Error / Auth Expiry Status Banner */}
        {errorBanner || isFromOfflineCache || checklistQueueCounts.total > 0 ? (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: authExpiredError
                  ? colors.dangerSoft
                  : checklistQueueCounts.conflict > 0 || checklistQueueCounts.failed > 0
                  ? colors.dangerSoft
                  : errorBanner || checklistQueueCounts.pending > 0
                  ? colors.warningSoft
                  : colors.infoSoft,
                borderColor: authExpiredError
                  ? colors.danger
                  : checklistQueueCounts.conflict > 0 || checklistQueueCounts.failed > 0
                  ? colors.danger
                  : errorBanner || checklistQueueCounts.pending > 0
                  ? colors.warning
                  : colors.primary,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.statusBannerTitle,
                  {
                    color: authExpiredError
                      ? colors.danger
                      : checklistQueueCounts.conflict > 0 || checklistQueueCounts.failed > 0
                      ? colors.danger
                      : errorBanner || checklistQueueCounts.pending > 0
                      ? colors.warning
                      : colors.primary,
                  },
                ]}
              >
                {authExpiredError
                  ? 'Authentication Required'
                  : checklistQueueCounts.conflict > 0
                  ? `Checklist Sync Conflict (${checklistQueueCounts.conflict})`
                  : checklistQueueCounts.failed > 0
                  ? `Checklist Sync Failed (${checklistQueueCounts.failed})`
                  : checklistQueueCounts.syncing > 0
                  ? `Syncing Queued Checklists (${checklistQueueCounts.syncing})...`
                  : checklistQueueCounts.pending > 0
                  ? `Pending Checklist Changes (${checklistQueueCounts.pending} Queued)`
                  : errorBanner
                  ? 'Checklist Sync Notice'
                  : 'Offline Checklist Cache Active'}
              </Text>
              <Text
                style={[styles.statusBannerText, { color: colors.textSecondary }]}
              >
                {errorBanner ||
                  (checklistQueueCounts.conflict > 0
                    ? 'One or more checklists have server conflicts (HTTP 409). Open the checklist to merge, keep local, or use the server version.'
                    : checklistQueueCounts.failed > 0
                    ? 'Some checklist mutations failed to synchronize. Tap Retry to re-submit queued changes safely.'
                    : checklistQueueCounts.pending > 0
                    ? isOfflineMode
                      ? 'Offline checklist mutations are durably queued for your account and will synchronize automatically when online.'
                      : 'Queued checklist mutations are ready to synchronize with /api/checklists.'
                    : 'Displaying user-scoped checklists from device cache. Changes will sync when backend connectivity is available.')}
              </Text>
            </View>
            {checklistQueueCounts.failed > 0 && !isOfflineMode ? (
              <Pressable
                onPress={() => handleRetryChecklistOp(null)}
                disabled={busyMutation}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(busyMutation) }}
                accessibilityLabel="Retry Failed Checklist Operations"
                style={[
                  styles.retryBtn,
                  { backgroundColor: colors.surface, borderColor: colors.danger },
                ]}
              >
                <Text style={[styles.retryBtnText, { color: colors.danger }]}>
                  Retry Failed
                </Text>
              </Pressable>
            ) : checklistQueueCounts.pending > 0 && !isOfflineMode && typeof syncNow === 'function' ? (
              <Pressable
                onPress={() => syncNow()}
                disabled={busyMutation || syncStatus?.isSyncing}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: Boolean(busyMutation || syncStatus?.isSyncing),
                }}
                accessibilityLabel="Sync Queued Checklists Now"
                style={[
                  styles.retryBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              >
                <Text style={[styles.retryBtnText, { color: colors.textOnPrimary }]}>
                  Sync Now
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => loadChecklists({ silent: false })}
                accessibilityRole="button"
                accessibilityLabel="Retry loading checklists"
                style={[
                  styles.retryBtn,
                  { backgroundColor: colors.surface, borderColor: colors.borderStrong },
                ]}
              >
                <Text style={[styles.retryBtnText, { color: colors.text }]}>
                  Retry
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {/* KPI Metrics Strip */}
        <View style={styles.kpiRow}>
          <View
            style={[
              styles.kpiCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.kpiValue,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              {summaryMetrics.totalChecklists}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
              Checklists
            </Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
              {summaryMetrics.completedChecklists} completed
            </Text>
          </View>

          <View
            style={[
              styles.kpiCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.kpiValue,
                { color: colors.text, fontFamily: monoFontFamily },
              ]}
            >
              {summaryMetrics.totalItems}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
              Total Checks
            </Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
              {summaryMetrics.pendingItems} pending
            </Text>
          </View>

          <View
            style={[
              styles.kpiCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.kpiValue,
                { color: colors.success, fontFamily: monoFontFamily },
              ]}
            >
              {summaryMetrics.completedItems}
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
              Completed Steps
            </Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
              {summaryMetrics.inProgressChecklists} active lists
            </Text>
          </View>

          <View
            style={[
              styles.kpiCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.kpiValue,
                {
                  color:
                    summaryMetrics.overallCompletionRate === 100
                      ? colors.success
                      : colors.primary,
                  fontFamily: monoFontFamily,
                },
              ]}
            >
              {summaryMetrics.overallCompletionRate}%
            </Text>
            <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>
              Completion Rate
            </Text>
            <Text style={[styles.kpiSub, { color: colors.textMuted }]}>
              Overall progress
            </Text>
          </View>
        </View>

        {/* Search & Multi-Criteria Filter Bar */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <VectorIcon name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search checklists by title, category, project, or step..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search checklists by title, category, project, or step"
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={[styles.searchInput, { color: colors.text }]}
            />
            {searchQuery ? (
              <Pressable
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Clear checklist search"
              >
                <VectorIcon name="close" size={15} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* Status Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onTouchStart={notifyBlockedSwipeTouchStart}
            contentContainerStyle={[
              styles.horizontalPillsRow,
              { marginTop: 10 },
            ]}
          >
            {['All', ...CHECKLIST_STATUSES].map((st) => {
              const active = statusFilter === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => setStatusFilter(st)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Filter checklists by status: ${
                    st === 'All' ? 'All Statuses' : st
                  }`}
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
                    {st === 'All' ? 'All Statuses' : st}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Category Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onTouchStart={notifyBlockedSwipeTouchStart}
            contentContainerStyle={[styles.horizontalPillsRow, { marginTop: 8 }]}
          >
            {['All', ...CHECKLIST_CATEGORIES].map((cat) => {
              const active = categoryFilter === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategoryFilter(cat)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Filter checklists by category: ${
                    cat === 'All' ? 'All Categories' : cat
                  }`}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active
                        ? colors.surfaceAccent
                        : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      {
                        color: active ? colors.primary : colors.textSecondary,
                      },
                    ]}
                  >
                    {cat === 'All' ? 'All Categories' : cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Loading / Empty / Checklists List */}
        {isLoading && checklists.length === 0 ? (
          <View
            style={[
              styles.card,
              styles.centeredStateCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 12 }]}>
              Loading QA Checklists...
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Synchronizing with /api/checklists...
            </Text>
          </View>
        ) : filteredChecklists.length === 0 ? (
          <View
            style={[
              styles.card,
              styles.centeredStateCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <VectorIcon name="clipboard" size={32} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.text, marginTop: 10 }]}>
              {scopedChecklists.length === 0
                ? scopeFilter === 'project'
                  ? `No QA checklists linked to "${selectedProject?.name || 'this project'}" yet`
                  : 'No QA checklists created yet'
                : 'No checklists match your active filters'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {scopedChecklists.length === 0
                ? 'Start from a battle-tested QA template or create a custom verification checklist.'
                : 'Clear your search query or reset status/category filters.'}
            </Text>

            {scopedChecklists.length === 0 ? (
              <View style={styles.emptyTemplateButtons}>
                {CHECKLIST_STARTER_TEMPLATES.map((tpl) => (
                  <Pressable
                    key={tpl.id}
                    onPress={() => openCreateModal(tpl.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Create checklist from template ${tpl.name}`}
                    style={[
                      styles.templateQuickBtn,
                      {
                        backgroundColor: colors.surfaceAccent,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <VectorIcon name="plus" size={14} color={colors.primary} />
                    <Text
                      style={[
                        styles.templateQuickBtnText,
                        { color: colors.primary },
                      ]}
                    >
                      {tpl.name}
                    </Text>
                  </Pressable>
                ))}
                {scopeFilter === 'project' && checklists.length > 0 ? (
                  <Pressable
                    onPress={() => setScopeFilter('all')}
                    accessibilityRole="button"
                    accessibilityLabel={`View all workspace checklists (${checklists.length})`}
                    style={[
                      styles.templateQuickBtn,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.borderStrong,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.templateQuickBtnText,
                        { color: colors.text },
                      ]}
                    >
                      View All Workspace Checklists ({checklists.length})
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setSearchQuery('');
                  setStatusFilter('All');
                  setCategoryFilter('All');
                }}
                accessibilityRole="button"
                accessibilityLabel="Reset checklist filters"
                style={[
                  styles.primaryHeaderBtn,
                  { backgroundColor: colors.primary, marginTop: 12 },
                ]}
              >
                <Text
                  style={[
                    styles.primaryHeaderBtnText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Reset Filters
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.checklistCardsList}>
            {filteredChecklists.map((chk) => {
              const statusPalette = getStatusBadgeColors(chk.status);
              const priorityPalette = getPriorityBadgeColors(chk.priority);
              const syncInfo = getChecklistSyncInfo(chk);
              const linkedProj = chk.projectId
                ? projects.find(
                    (p) => String(p.id || p._id) === String(chk.projectId)
                  )
                : null;
              const projName =
                (linkedProj && linkedProj.name) ||
                chk.projectName ||
                (chk.projectId ? `Project ${chk.projectId}` : 'Workspace');

              return (
                <Pressable
                  key={chk.id}
                  onPress={() => handleSelectChecklist(chk)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open checklist ${chk.title}, ${chk.status}, ${chk.completedItems} of ${chk.totalItems} completed`}
                  style={[
                    styles.checklistCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor:
                        syncInfo.state === 'conflict' || syncInfo.state === 'failed'
                          ? colors.danger
                          : syncInfo.state === 'pending'
                          ? colors.warning
                          : colors.border,
                    },
                  ]}
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.badgeRow}>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: statusPalette.bg },
                        ]}
                      >
                        <Text
                          style={[styles.badgeText, { color: statusPalette.fg }]}
                        >
                          {chk.status}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: priorityPalette.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: priorityPalette.fg },
                          ]}
                        >
                          {chk.priority}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: colors.surfaceMuted },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {chk.category}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: syncInfo.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: syncInfo.fg },
                          ]}
                        >
                          {syncInfo.label}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardQuickButtons}>
                      <Pressable
                        onPress={(e) => {
                          if (e && typeof e.stopPropagation === 'function') {
                            e.stopPropagation();
                          }
                          openPromoteModal(chk);
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Promote checklist ${chk.title} to test cases`}
                        style={[
                          styles.promoteCardBtn,
                          {
                            backgroundColor: colors.surfaceAccent,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="layers"
                          size={13}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.promoteCardBtnText,
                            { color: colors.primary },
                          ]}
                        >
                          Promote
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={(e) => {
                          if (e && typeof e.stopPropagation === 'function') {
                            e.stopPropagation();
                          }
                          openEditModal(chk);
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit checklist ${chk.title}`}
                        style={[
                          styles.iconBtn,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="edit"
                          size={14}
                          color={colors.textSecondary}
                        />
                      </Pressable>

                      <Pressable
                        onPress={(e) => {
                          if (e && typeof e.stopPropagation === 'function') {
                            e.stopPropagation();
                          }
                          setDeleteTargetChecklist(chk);
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete checklist ${chk.title}`}
                        style={[
                          styles.iconBtn,
                          {
                            backgroundColor: colors.dangerSoft,
                            borderColor: colors.danger,
                          },
                        ]}
                      >
                        <VectorIcon
                          name="trash"
                          size={14}
                          color={colors.danger}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    {chk.title}
                  </Text>

                  {chk.description ? (
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.cardDescription,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {chk.description}
                    </Text>
                  ) : null}

                  {syncInfo.state === 'conflict' || syncInfo.state === 'failed' ? (
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.cardDescription,
                        { color: colors.danger, fontWeight: '600' },
                      ]}
                    >
                      {syncInfo.error}
                    </Text>
                  ) : null}

                  <Text
                    style={[
                      styles.metaLine,
                      { color: colors.textMuted, fontFamily: monoFontFamily },
                    ]}
                  >
                    {projName} · {chk.environment || 'Staging'}
                    {chk.targetRelease ? ` · ${chk.targetRelease}` : ''} ·{' '}
                    {chk.completedItems}/{chk.totalItems} checks done
                  </Text>

                  {/* Card Progress Bar */}
                  <View style={styles.cardProgressRow}>
                    <View
                      style={[
                        styles.progressTrack,
                        { flex: 1, backgroundColor: colors.surfaceMuted },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(100, Math.max(0, chk.completionRate))}%`,
                            backgroundColor:
                              chk.completionRate === 100
                                ? colors.success
                                : colors.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.cardProgressPercent,
                        {
                          color:
                            chk.completionRate === 100
                              ? colors.success
                              : colors.primary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {chk.completionRate}%
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {renderChecklistModals()}
    </View>
  );
}

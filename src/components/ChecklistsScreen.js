import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useWorkspace } from '../context/WorkspaceContext';
import VectorIcon from './VectorIcon';
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
} from '../services/checklistService';

export default function ChecklistsScreen({ onBackToOverview }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { selectedProject, projects, isOfflineMode } = useProjects();
  const {
    showToast,
    checklists: workspaceChecklists,
    setChecklists: setWorkspaceChecklists,
  } = useWorkspace();

  const currentUserId = useMemo(
    () => (user && (user.id || user._id) ? String(user.id || user._id).trim() : ''),
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

  // Active checklist detail & item filters
  const [activeChecklistId, setActiveChecklistId] = useState(null);
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

  // Create / Edit Checklist Modal state
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' | 'edit'
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

  const loadGenerationRef = useRef(0);
  const mutationLockRef = useRef(false);

  const syncChecklistsState = useCallback(
    (nextList, persistCache = true) => {
      const normalized = (Array.isArray(nextList) ? nextList : [])
        .map(normalizeChecklistRecord)
        .filter(Boolean);
      const owned = filterChecklistsForUser(normalized, currentUserId);
      setChecklistsState(owned);
      if (typeof setWorkspaceChecklists === 'function') {
        setWorkspaceChecklists(owned);
      }
      if (persistCache && currentUserId) {
        cacheChecklistsForUser(owned, currentUserId).catch(() => {});
      }
      return owned;
    },
    [currentUserId, setWorkspaceChecklists]
  );

  // Load checklists from backend `/api/checklists` with per-user cache fallback
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
        // Hydrate from per-user cache first if list is empty so UI responds fast
        const cached = await getCachedChecklistsForUser(currentUserId);
        if (gen !== loadGenerationRef.current) return;

        const apiRes = await fetchChecklists({ userId: currentUserId });
        if (gen !== loadGenerationRef.current) return;

        if (apiRes.ok) {
          setIsFromOfflineCache(false);
          syncChecklistsState(apiRes.checklists, true);
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
          true
        );
      }
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
    setFormModalVisible(true);
  };

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

    mutationLockRef.current = true;
    setBusyMutation(true);
    setFormError(null);

    try {
      const targetProjId =
        formProjectScope === 'current' && selectedProjectId
          ? selectedProjectId
          : null;
      const targetProjName =
        formProjectScope === 'current' && selectedProject
          ? selectedProject.name || ''
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
          const nextList = [res.checklist, ...checklists];
          syncChecklistsState(nextList, true);
          setFormModalVisible(false);
          setActiveChecklistId(res.checklist.id);
          if (showToast) {
            showToast(`Created checklist "${res.checklist.title}".`, 'success');
          }
        } else if (res.isNetworkError || isOfflineMode) {
          // Safe per-user local cache fallback when offline
          const offlineChecklist = normalizeChecklistRecord({
            ...createPayload,
            id: `chk_local_${Date.now()}`,
            userId: currentUserId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          const nextList = [offlineChecklist, ...checklists];
          syncChecklistsState(nextList, true);
          setIsFromOfflineCache(true);
          setFormModalVisible(false);
          setActiveChecklistId(offlineChecklist.id);
          if (showToast) {
            showToast(
              `Saved "${offlineChecklist.title}" to offline checklist cache.`,
              'info'
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
          expectedUpdatedAt: existing?.updatedAt || undefined,
        };

        const res = await updateChecklist(editingChecklistId, updates, {
          userId: currentUserId,
        });

        if (res.ok && res.checklist) {
          const nextList = checklists.map((c) =>
            c.id === editingChecklistId ? { ...c, ...res.checklist } : c
          );
          syncChecklistsState(nextList, true);
          setFormModalVisible(false);
          if (showToast) {
            showToast(`Updated checklist "${res.checklist.title}".`, 'success');
          }
        } else if (res.isConflict && res.serverChecklist) {
          const nextList = checklists.map((c) =>
            c.id === editingChecklistId ? res.serverChecklist : c
          );
          syncChecklistsState(nextList, true);
          setFormError(
            'Conflict detected (HTTP 409): This checklist was modified on the server. Loaded latest server version.'
          );
        } else if (res.isNetworkError || isOfflineMode) {
          const updatedOffline = normalizeChecklistRecord({
            ...existing,
            ...updates,
            id: editingChecklistId,
            userId: currentUserId,
            updatedAt: new Date().toISOString(),
          });
          const nextList = checklists.map((c) =>
            c.id === editingChecklistId ? updatedOffline : c
          );
          syncChecklistsState(nextList, true);
          setIsFromOfflineCache(true);
          setFormModalVisible(false);
          if (showToast) {
            showToast('Updated checklist in offline cache.', 'info');
          }
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
      const res = await deleteChecklist(targetId);
      if (res.ok || res.isNetworkError || isOfflineMode || res.status === 404) {
        const nextList = checklists.filter((c) => c.id !== targetId);
        syncChecklistsState(nextList, true);
        if (activeChecklistId === targetId) {
          setActiveChecklistId(null);
        }
        setDeleteTargetChecklist(null);
        if (showToast) {
          showToast(`Deleted checklist "${targetTitle}".`, 'info');
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
    // Compute optimistic record
    const optimisticItems = activeChecklist.items.map((it) =>
      it.id === item.id
        ? {
            ...it,
            completed: nextCompleted,
            checked: nextCompleted,
            status: nextCompleted ? 'Completed' : 'Pending',
            completedAt: nextCompleted ? new Date().toISOString() : null,
            updatedAt: new Date().toISOString(),
          }
        : it
    );
    const optimisticChecklist = normalizeChecklistRecord({
      ...activeChecklist,
      items: optimisticItems,
      updatedAt: new Date().toISOString(),
    });

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
          true
        );
      } else if (res.isConflict && res.serverChecklist) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? res.serverChecklist : c
          ),
          true
        );
        if (showToast) {
          showToast(
            'Server version was newer (409); refreshed checklist.',
            'warning'
          );
        }
      } else if (res.isNetworkError || isOfflineMode) {
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? optimisticChecklist : c
          ),
          true
        );
        setIsFromOfflineCache(true);
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
          true
        );
        setNewItemTitle('');
        setNewItemNotes('');
        if (showToast) {
          showToast('Checklist item added.', 'success');
        }
      } else if (res.isNetworkError || isOfflineMode) {
        const fallbackUpdated = normalizeChecklistRecord({
          ...activeChecklist,
          items: [...activeChecklist.items, newItemObj],
          updatedAt: new Date().toISOString(),
        });
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? fallbackUpdated : c
          ),
          true
        );
        setNewItemTitle('');
        setNewItemNotes('');
        setIsFromOfflineCache(true);
        if (showToast) {
          showToast('Item saved to offline checklist cache.', 'info');
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
          true
        );
        setEditingItem(null);
        if (showToast) {
          showToast('Updated checklist item.', 'success');
        }
      } else if (res.isNetworkError || isOfflineMode) {
        const nextItems = activeChecklist.items.map((it) =>
          it.id === editingItem.id ? { ...it, ...itemUpdates, text: cleanTitle } : it
        );
        const fallbackChecklist = normalizeChecklistRecord({
          ...activeChecklist,
          items: nextItems,
          updatedAt: new Date().toISOString(),
        });
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? fallbackChecklist : c
          ),
          true
        );
        setEditingItem(null);
        setIsFromOfflineCache(true);
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
          true
        );
        if (showToast) {
          showToast('Removed checklist item.', 'info');
        }
      } else if (res.isNetworkError || isOfflineMode) {
        const nextItems = activeChecklist.items.filter((it) => it.id !== itemId);
        const fallbackChecklist = normalizeChecklistRecord({
          ...activeChecklist,
          items: nextItems,
          updatedAt: new Date().toISOString(),
        });
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? fallbackChecklist : c
          ),
          true
        );
        setIsFromOfflineCache(true);
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
          true
        );
        if (showToast) {
          showToast(
            completed
              ? 'All checklist items marked Complete.'
              : 'All checklist items reset to Pending.',
            'success'
          );
        }
      } else if (res.isNetworkError || isOfflineMode) {
        const nowIso = new Date().toISOString();
        const nextItems = activeChecklist.items.map((it) => ({
          ...it,
          completed,
          checked: completed,
          status: completed ? 'Completed' : 'Pending',
          completedAt: completed ? nowIso : null,
          updatedAt: nowIso,
        }));
        const fallbackChecklist = normalizeChecklistRecord({
          ...activeChecklist,
          items: nextItems,
          updatedAt: nowIso,
        });
        syncChecklistsState(
          checklists.map((c) =>
            c.id === activeChecklist.id ? fallbackChecklist : c
          ),
          true
        );
        setIsFromOfflineCache(true);
      } else {
        setErrorBanner(res.error || 'Failed to update checklist items.');
      }
    } finally {
      mutationLockRef.current = false;
      setBusyMutation(false);
    }
  };

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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
                onPress={() => openEditModal(activeChecklist)}
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
                value={newItemTitle}
                onChangeText={setNewItemTitle}
                placeholder="Enter verification step or QA check..."
                placeholderTextColor={colors.textMuted}
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
              <View style={styles.priorityPillsRow}>
                {CHECKLIST_PRIORITIES.map((prio) => {
                  const active = newItemPriority === prio;
                  return (
                    <Pressable
                      key={prio}
                      onPress={() => setNewItemPriority(prio)}
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
                value={newItemNotes}
                onChangeText={setNewItemNotes}
                placeholder="Optional verification note / expected outcome..."
                placeholderTextColor={colors.textMuted}
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

              <View style={styles.itemFilterTabs}>
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
        <Modal
          visible={Boolean(editingItem)}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingItem(null)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Edit Verification Step
              </Text>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Step Title *
              </Text>
              <TextInput
                value={editItemTitle}
                onChangeText={setEditItemTitle}
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
                Priority
              </Text>
              <View style={[styles.priorityPillsRow, { marginBottom: 12 }]}>
                {CHECKLIST_PRIORITIES.map((prio) => {
                  const active = editItemPriority === prio;
                  return (
                    <Pressable
                      key={prio}
                      onPress={() => setEditItemPriority(prio)}
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

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Notes / Expected Outcome
              </Text>
              <TextInput
                value={editItemNotes}
                onChangeText={setEditItemNotes}
                multiline
                style={[
                  styles.input,
                  {
                    minHeight: 68,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                    textAlignVertical: 'top',
                    paddingTop: 10,
                  },
                ]}
              />

              <View style={styles.modalActionsRow}>
                <Pressable
                  onPress={() => setEditingItem(null)}
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
                  onPress={handleSaveEditedItem}
                  disabled={busyMutation || !editItemTitle.trim()}
                  style={[
                    styles.modalConfirmBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: busyMutation || !editItemTitle.trim() ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modalConfirmText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    {busyMutation ? 'Saving...' : 'Save Step'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

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
        {/* Create / Edit Checklist Modal */}
        <Modal
          visible={formModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFormModalVisible(false)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {formMode === 'create'
                    ? 'Create QA Checklist'
                    : 'Edit QA Checklist'}
                </Text>

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
                  value={formTitle}
                  onChangeText={setFormTitle}
                  placeholder="e.g., Android v2.4 Release Readiness Checklist"
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
                  Description
                </Text>
                <TextInput
                  value={formDescription}
                  onChangeText={setFormDescription}
                  placeholder="Describe the verification scope and sign-off criteria..."
                  placeholderTextColor={colors.textMuted}
                  multiline
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
                <View style={[styles.priorityPillsRow, { marginBottom: 12 }]}>
                  {CHECKLIST_PRIORITIES.map((prio) => {
                    const active = formPriority === prio;
                    return (
                      <Pressable
                        key={prio}
                        onPress={() => setFormPriority(prio)}
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
                <View style={[styles.priorityPillsRow, { marginBottom: 12 }]}>
                  {selectedProjectId ? (
                    <Pressable
                      onPress={() => setFormProjectScope('current')}
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
                      value={formEnvironment}
                      onChangeText={setFormEnvironment}
                      placeholder="Staging"
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
                      Target Release
                    </Text>
                    <TextInput
                      value={formTargetRelease}
                      onChangeText={setFormTargetRelease}
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
                </View>

                {formMode === 'create' ? (
                  <>
                    <Text
                      style={[styles.fieldLabel, { color: colors.textSecondary }]}
                    >
                      Initial Checklist Items (One per line, optional)
                    </Text>
                    <TextInput
                      value={formCustomItemsText}
                      onChangeText={setFormCustomItemsText}
                      placeholder={
                        'Verify login session cookie persistence\nValidate CSRF header on mutations\nConfirm dark mode contrast'
                      }
                      placeholderTextColor={colors.textMuted}
                      multiline
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

                <View style={styles.modalActionsRow}>
                  <Pressable
                    onPress={() => setFormModalVisible(false)}
                    disabled={busyMutation}
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
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Destructive Delete Checklist Confirmation Modal */}
        <Modal
          visible={Boolean(deleteTargetChecklist)}
          transparent
          animationType="fade"
          onRequestClose={() => setDeleteTargetChecklist(null)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.danger }]}>
                Delete QA Checklist?
              </Text>
              <Text
                style={[
                  styles.detailDesc,
                  { color: colors.textSecondary, marginBottom: 16 },
                ]}
              >
                Are you sure you want to permanently delete{' '}
                <Text style={{ fontWeight: '700', color: colors.text }}>
                  {deleteTargetChecklist?.title}
                </Text>{' '}
                and its {deleteTargetChecklist?.totalItems || 0} verification
                items? This action cannot be undone.
              </Text>

              <View style={styles.modalActionsRow}>
                <Pressable
                  onPress={() => setDeleteTargetChecklist(null)}
                  disabled={busyMutation}
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
                  onPress={handleConfirmDeleteChecklist}
                  disabled={busyMutation}
                  style={[
                    styles.modalConfirmBtn,
                    {
                      backgroundColor: colors.danger,
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
                    {busyMutation ? 'Deleting...' : 'Delete Permanently'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  // ============================================================================
  // RENDER: STANDALONE QA CHECKLISTS LIST SCREEN
  // ============================================================================
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
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
                    Overview
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => loadChecklists({ silent: true })}
                disabled={isLoading || isRefreshing}
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
          <View style={styles.scopeToggleRow}>
            {selectedProjectId ? (
              <Pressable
                onPress={() => setScopeFilter('project')}
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
        {errorBanner || isFromOfflineCache ? (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: authExpiredError
                  ? colors.dangerSoft
                  : errorBanner
                  ? colors.warningSoft
                  : colors.infoSoft,
                borderColor: authExpiredError
                  ? colors.danger
                  : errorBanner
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
                      : errorBanner
                      ? colors.warning
                      : colors.primary,
                  },
                ]}
              >
                {authExpiredError
                  ? 'Authentication Required'
                  : errorBanner
                  ? 'Checklist Sync Notice'
                  : 'Offline Checklist Cache Active'}
              </Text>
              <Text
                style={[styles.statusBannerText, { color: colors.textSecondary }]}
              >
                {errorBanner ||
                  'Displaying user-scoped checklists from device cache. Changes will sync when backend connectivity is available.'}
              </Text>
            </View>
            <Pressable
              onPress={() => loadChecklists({ silent: false })}
              style={[
                styles.retryBtn,
                { backgroundColor: colors.surface, borderColor: colors.borderStrong },
              ]}
            >
              <Text style={[styles.retryBtnText, { color: colors.text }]}>
                Retry
              </Text>
            </Pressable>
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
              style={[styles.searchInput, { color: colors.text }]}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')}>
                <VectorIcon name="close" size={15} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* Status Filter Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
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
            contentContainerStyle={[styles.horizontalPillsRow, { marginTop: 8 }]}
          >
            {['All', ...CHECKLIST_CATEGORIES].map((cat) => {
              const active = categoryFilter === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategoryFilter(cat)}
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
                  style={[
                    styles.checklistCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
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
                    </View>

                    <View style={styles.cardQuickButtons}>
                      <Pressable
                        onPress={(e) => {
                          if (e && typeof e.stopPropagation === 'function') {
                            e.stopPropagation();
                          }
                          openEditModal(chk);
                        }}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 96,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  centeredStateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 220,
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  screenSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  headerActionsCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  primaryHeaderBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryHeaderBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryHeaderBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryHeaderBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scopeToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  scopeTab: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scopeTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusBannerText: {
    fontSize: 12,
    lineHeight: 17,
  },
  retryBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 2,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  kpiSub: {
    fontSize: 11,
    marginTop: 2,
  },
  searchBox: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  horizontalPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterPill: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  checklistCardsList: {
    gap: 10,
  },
  checklistCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 15,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardQuickButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  metaLine: {
    fontSize: 11,
    marginTop: 2,
    marginBottom: 10,
  },
  cardProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  cardProgressPercent: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 38,
    textAlign: 'right',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 460,
  },
  emptyTemplateButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  templateQuickBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  templateQuickBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailTopBar: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  backBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallActionBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 4,
  },
  detailDesc: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
  },
  progressSection: {
    marginTop: 6,
    marginBottom: 12,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '800',
  },
  bulkActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  secondaryBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addItemRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  addItemInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addItemSubmitBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addItemSubmitText: {
    fontSize: 13,
    fontWeight: '700',
  },
  itemMetaComposerRow: {
    marginTop: 10,
    gap: 8,
  },
  priorityPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  miniPill: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemNotesInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  itemsHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  itemFilterTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemFilterBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemFilterBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyItemsBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  itemsList: {
    gap: 8,
  },
  itemRow: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkboxHitbox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  itemTextColumn: {
    flex: 1,
  },
  itemTitleText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  itemNotesText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  itemMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  itemPriorityTag: {
    fontSize: 11,
    fontWeight: '700',
  },
  itemCategoryTag: {
    fontSize: 11,
  },
  itemCompletedTag: {
    fontSize: 11,
    fontWeight: '700',
  },
  itemRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalBackdrop: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  errorAlert: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  errorAlertText: {
    fontSize: 12,
    fontWeight: '600',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
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
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  modalCancelBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalConfirmBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

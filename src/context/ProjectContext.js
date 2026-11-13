/**
 * Qavora Android — Dedicated Multi-Project State & Offline Sync Architecture (Phases 2A–2F)
 *
 * Manages multiple projects belonging to the authenticated user against the
 * Qavora Web Express 5 + MongoDB 7 backend (`/api/projects*`) with full
 * offline-first caching and background synchronization (`offlineSyncService.js`):
 * - Project list (`projects`) & status filtering
 * - Currently selected project (`selectedProjectId`, `selectedProject`), persisted
 *   per user across app restarts in AsyncStorage (`@qavora_selected_project_id_v1:<userId>`)
 * - Per-user offline project cache (`@qavora_offline_projects_cache_v1:<userId>`)
 * - Durable per-user offline mutation queue (`@qavora_pending_project_ops_v1:<userId>`)
 * - Automatic synchronization when connectivity is restored
 * - Loading, mutation, error, and HTTP 409 optimistic concurrency conflict states
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext.js';
import {
  PROJECT_STATUSES,
  fetchProjects,
  fetchProjectById,
  createProject as createProjectApi,
  updateProjectPut as updateProjectPutApi,
  updateProjectMetadata as updateProjectMetadataApi,
  updateProjectStatus as updateProjectStatusApi,
  updateProjectData as updateProjectDataApi,
  deleteProject as deleteProjectApi,
  normalizeProjectRecord,
  buildDefaultTestPlan,
} from '../services/projectService.js';
import {
  isClientOffline,
  setSimulatedOfflineMode,
  setActiveSyncUser,
  checkInitialConnectivity,
  startConnectivityMonitoring,
  triggerReconnectSyncForUser,
  subscribeToReconnectSyncResults,
  subscribeToSyncEvents,
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  getCachedProjectsForUser,
  getCachedProjectById,
  queueProjectMutation,
  getProjectSyncStatus,
  processProjectSyncQueue,
  resolveProjectConflict,
  retryProjectOperation,
  retryFailedProjectOperations,
  discardProjectOperation,
} from '../services/offlineSyncService.js';

export const SELECTED_PROJECT_STORAGE_PREFIX = '@qavora_selected_project_id_v1:';

let customProjectStorageAdapter = null;

function getStorage() {
  if (customProjectStorageAdapter) {
    return customProjectStorageAdapter;
  }
  return AsyncStorage;
}

/**
 * Allows injecting a storage adapter for deterministic persistence verification tests.
 */
export function setProjectStorageAdapter(adapter) {
  customProjectStorageAdapter = adapter;
}

export function getSelectedProjectStorageKey(userId) {
  return `${SELECTED_PROJECT_STORAGE_PREFIX}${userId || 'anonymous'}`;
}

/**
 * Reads the persisted selected project ID for a specific user from AsyncStorage.
 *
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
export async function loadPersistedSelectedProjectId(userId) {
  if (!userId) return null;
  try {
    const storage = getStorage();
    if (storage && typeof storage.getItem === 'function') {
      const value = await storage.getItem(getSelectedProjectStorageKey(userId));
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
  } catch {
    // Ignore storage read failures
  }
  return null;
}

/**
 * Persists or clears the selected project ID for a specific user in AsyncStorage.
 *
 * @param {string} userId
 * @param {string | null} projectId
 */
export async function savePersistedSelectedProjectId(userId, projectId) {
  if (!userId) return;
  const key = getSelectedProjectStorageKey(userId);
  try {
    const storage = getStorage();
    if (!storage) return;
    if (typeof projectId === 'string' && projectId.trim()) {
      await storage.setItem(key, projectId.trim());
    } else if (typeof storage.removeItem === 'function') {
      await storage.removeItem(key);
    }
  } catch {
    // Ignore storage write failures
  }
}

const INITIAL_SYNC_STATUS = {
  online: true,
  simulatedOffline: false,
  isSyncing: false,
  totalQueued: 0,
  pendingCount: 0,
  syncingCount: 0,
  conflictCount: 0,
  failedCount: 0,
  operations: [],
};

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const activeUserId = user && user.userId ? String(user.userId) : null;

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState(null);
  const [hasLoadedInitialProjects, setHasLoadedInitialProjects] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [projectError, setProjectError] = useState(null);
  const [conflictState, setConflictState] = useState(null);
  const [syncStatus, setSyncStatus] = useState(INITIAL_SYNC_STATUS);

  const effectiveSyncUserId =
    isAuthenticated && activeUserId ? activeUserId : null;

  const projectsRef = useRef(projects);
  const selectedProjectIdRef = useRef(selectedProjectId);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  // Keep offlineSyncService informed of the currently authenticated user after commit
  // (never during render) and clear on user change or unmount so User A's queue is
  // never synced while User B is authenticated or after logout.
  useEffect(() => {
    setActiveSyncUser(effectiveSyncUserId);
    return () => {
      setActiveSyncUser(null);
    };
  }, [effectiveSyncUserId]);

  const clearProjectError = useCallback(() => {
    setProjectError(null);
    setConflictState(null);
  }, []);

  /**
   * Refreshes the in-memory `syncStatus` snapshot for the active user.
   */
  const refreshSyncStatus = useCallback(async () => {
    if (!activeUserId) {
      setSyncStatus({
        ...INITIAL_SYNC_STATUS,
        online: !isClientOffline(),
      });
      return INITIAL_SYNC_STATUS;
    }
    const status = await getProjectSyncStatus(activeUserId);
    setSyncStatus(status);
    return status;
  }, [activeUserId]);

  /**
   * Persists the selected project ID for the active user in AsyncStorage.
   */
  const persistSelectedProjectId = useCallback(
    async (nextProjectId) => {
      if (!activeUserId) return;
      await savePersistedSelectedProjectId(activeUserId, nextProjectId);
    },
    [activeUserId]
  );

  /**
   * Selects a project by `id` (or `_id`) and persists the selection across restarts.
   */
  const selectProject = useCallback(
    async (projectId) => {
      const cleanId =
        typeof projectId === 'string' && projectId.trim()
          ? projectId.trim()
          : null;
      selectedProjectIdRef.current = cleanId;
      setSelectedProjectIdState(cleanId);
      await persistSelectedProjectId(cleanId);
    },
    [persistSelectedProjectId]
  );

  /**
   * Clears the currently selected project so the user returns to the Project Selection screen.
   */
  const clearSelectedProject = useCallback(async () => {
    selectedProjectIdRef.current = null;
    setSelectedProjectIdState(null);
    await persistSelectedProjectId(null);
  }, [persistSelectedProjectId]);

  /**
   * Synchronizes a single updated or hydrated project into the `projects` list
   * and updates the user's offline project cache.
   */
  const upsertProjectInState = useCallback(
    (projectRecord, cacheOptions = {}) => {
      if (!projectRecord || typeof projectRecord !== 'object') return;
      const recordId = projectRecord.id || projectRecord._id;
      if (!recordId) return;

      setProjects((prev) => {
        const index = prev.findIndex(
          (item) => item.id === recordId || item._id === recordId
        );
        if (index === -1) {
          return [projectRecord, ...prev];
        }
        const next = [...prev];
        next[index] = projectRecord;
        return next;
      });

      if (activeUserId) {
        cacheProjectOffline(projectRecord, activeUserId, cacheOptions).catch(
          () => {}
        );
      }
    },
    [activeUserId]
  );

  /**
   * Reconciles `selectedProjectId` against a loaded list of projects.
   */
  const reconcileSelectedProjectWithList = useCallback(
    async (loadedProjects, autoSelectFirst = false) => {
      if (!activeUserId) return;
      const storedSelection = await loadPersistedSelectedProjectId(activeUserId);
      const currentSelectedId = selectedProjectIdRef.current;
      const candidateId = currentSelectedId || storedSelection;

      const matchedProject = candidateId
        ? loadedProjects.find(
            (p) => p.id === candidateId || p._id === candidateId
          )
        : null;

      if (matchedProject) {
        const resolvedId = matchedProject.id || matchedProject._id;
        selectedProjectIdRef.current = resolvedId;
        setSelectedProjectIdState(resolvedId);
        if (storedSelection !== resolvedId) {
          await persistSelectedProjectId(resolvedId);
        }
      } else if (autoSelectFirst && loadedProjects.length > 0) {
        const firstId = loadedProjects[0].id || loadedProjects[0]._id;
        selectedProjectIdRef.current = firstId;
        setSelectedProjectIdState(firstId);
        await persistSelectedProjectId(firstId);
      } else {
        selectedProjectIdRef.current = null;
        setSelectedProjectIdState(null);
        if (storedSelection) {
          await persistSelectedProjectId(null);
        }
      }
    },
    [activeUserId, persistSelectedProjectId]
  );

  /**
   * Fetches all projects belonging to the authenticated user (`GET /api/projects`).
   * If offline or a network error occurs, seamlessly falls back to the user's
   * isolated offline project cache (`@qavora_offline_projects_cache_v1:<userId>`).
   */
  const refreshProjects = useCallback(
    async (options = {}) => {
      if (!isAuthenticated || !activeUserId) {
        setProjects([]);
        selectedProjectIdRef.current = null;
        setSelectedProjectIdState(null);
        setHasLoadedInitialProjects(false);
        return {
          ok: false,
          status: 401,
          projects: [],
          error: 'Authentication required to fetch projects.',
        };
      }

      const isSilent = Boolean(options && options.silent);
      const isPullRefresh = Boolean(options && options.pullToRefresh);
      const autoSelectFirst = Boolean(options && options.autoSelectFirst);

      if (!isSilent) {
        if (isPullRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setProjectError(null);
      }

      try {
        // If explicitly in offline mode, read directly from user's offline project cache
        if (isClientOffline()) {
          const cachedProjects = await getCachedProjectsForUser(
            activeUserId,
            true
          );
          setProjects(cachedProjects);
          await reconcileSelectedProjectWithList(
            cachedProjects,
            autoSelectFirst
          );
          await refreshSyncStatus();
          return {
            ok: true,
            status: 200,
            offlineFallback: true,
            projects: cachedProjects,
            error: null,
          };
        }

        const {
          silent: _s,
          pullToRefresh: _p,
          autoSelectFirst: _a,
          ...apiOptions
        } = options || {};
        const result = await fetchProjects(apiOptions);

        if (!result.ok) {
          // If network failure (not 401/403), fall back to user's cached projects
          if (result.isNetworkError || result.status === 0) {
            const cachedProjects = await getCachedProjectsForUser(
              activeUserId,
              true
            );
            setProjects(cachedProjects);
            await reconcileSelectedProjectWithList(
              cachedProjects,
              autoSelectFirst
            );
            await refreshSyncStatus();
            return {
              ok: true,
              status: 200,
              offlineFallback: true,
              projects: cachedProjects,
              error: null,
            };
          }

          if (!isSilent) {
            setProjectError(result.error || 'Failed to load projects.');
          }
          return result;
        }

        const serverProjects = Array.isArray(result.projects)
          ? result.projects
          : [];
        const mergedCachedList = await cacheProjectsListOffline(
          serverProjects,
          activeUserId
        );
        const resolvedProjects =
          mergedCachedList.length > 0 ? mergedCachedList : serverProjects;

        setProjects(resolvedProjects);
        await reconcileSelectedProjectWithList(
          resolvedProjects,
          autoSelectFirst
        );
        await refreshSyncStatus();

        return {
          ...result,
          projects: resolvedProjects,
        };
      } finally {
        setHasLoadedInitialProjects(true);
        if (!isSilent) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [
      isAuthenticated,
      activeUserId,
      reconcileSelectedProjectWithList,
      refreshSyncStatus,
    ]
  );

  /**
   * Synchronizes all pending offline mutations for the authenticated user.
   */
  const syncOfflineQueue = useCallback(
    async (options = {}) => {
      if (!isAuthenticated || !activeUserId) {
        return {
          synced: 0,
          failed: 0,
          conflicts: 0,
          skipped: true,
          reason: 'unauthenticated',
        };
      }
      const res = await processProjectSyncQueue(activeUserId, options);
      await refreshSyncStatus();
      if (res.synced > 0 && !isClientOffline()) {
        await refreshProjects({ silent: true });
      }
      return res;
    },
    [isAuthenticated, activeUserId, refreshSyncStatus, refreshProjects]
  );

  // Subscribe to native NetInfo + web window + AppState connectivity monitoring
  // and automatic reconnection sync events
  useEffect(() => {
    const stopMonitoring = startConnectivityMonitoring();

    if (!isAuthenticated || !activeUserId) {
      setActiveSyncUser(null);
      setSyncStatus(INITIAL_SYNC_STATUS);
      return () => {
        stopMonitoring();
      };
    }

    setActiveSyncUser(activeUserId);
    refreshSyncStatus();

    const unsubscribeSyncEvents = subscribeToSyncEvents(() => {
      refreshSyncStatus();
    });

    const unsubscribeReconnectResults = subscribeToReconnectSyncResults(
      ({ userId: syncedUserId, result }) => {
        if (syncedUserId !== activeUserId) {
          return;
        }
        refreshSyncStatus();
        if (result && result.synced > 0 && !isClientOffline()) {
          refreshProjects({ silent: true });
        }
      }
    );

    return () => {
      unsubscribeSyncEvents();
      unsubscribeReconnectResults();
      stopMonitoring();
    };
  }, [isAuthenticated, activeUserId, refreshSyncStatus, refreshProjects]);

  // Automatically load user projects when authenticated user session becomes active;
  // clear in-memory project state when logged out (preserving offline cache & queue on disk).
  useEffect(() => {
    let mounted = true;

    if (!isAuthenticated || !activeUserId) {
      setActiveSyncUser(null);
      setProjects([]);
      selectedProjectIdRef.current = null;
      setSelectedProjectIdState(null);
      setHasLoadedInitialProjects(false);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsMutating(false);
      setProjectError(null);
      setConflictState(null);
      setSyncStatus(INITIAL_SYNC_STATUS);
      return () => {
        mounted = false;
      };
    }

    setActiveSyncUser(activeUserId);
    selectedProjectIdRef.current = null;
    setSelectedProjectIdState(null);
    setHasLoadedInitialProjects(false);

    (async () => {
      if (!mounted) return;
      // 1. Hydrate immediately from offline cache if available so startup is fast
      const cached = await getCachedProjectsForUser(activeUserId, true);
      if (mounted && cached.length > 0) {
        setProjects(cached);
        await reconcileSelectedProjectWithList(cached, false);
      }

      // 2. Perform an explicit initial connectivity check (NetInfo.fetch + navigator fallback)
      await checkInitialConnectivity('project_context_startup');
      if (!mounted) return;

      // 3. If online and there are pending operations for this user, sync them via single-flight coordinator
      if (!isClientOffline()) {
        await triggerReconnectSyncForUser(activeUserId, {
          source: 'project_context_startup',
        });
      }
      if (!mounted) return;
      await refreshProjects();
    })();

    return () => {
      mounted = false;
    };
  }, [
    isAuthenticated,
    activeUserId,
    reconcileSelectedProjectWithList,
    refreshProjects,
  ]);

  /**
   * Fetches an individual project by ID (`GET /api/projects/:id`) with offline cache fallback.
   */
  const getProject = useCallback(
    async (projectId, options = {}) => {
      setIsLoading(true);
      setProjectError(null);

      try {
        if (isClientOffline() && activeUserId) {
          const cached = await getCachedProjectById(
            projectId,
            activeUserId,
            true
          );
          if (cached) {
            upsertProjectInState(cached);
            return {
              ok: true,
              status: 200,
              offlineFallback: true,
              project: cached,
              error: null,
            };
          }
        }

        const result = await fetchProjectById(projectId, options);
        if (result.ok && result.project) {
          upsertProjectInState(result.project);
          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          const cached = await getCachedProjectById(
            projectId,
            activeUserId,
            true
          );
          if (cached) {
            upsertProjectInState(cached);
            return {
              ok: true,
              status: 200,
              offlineFallback: true,
              project: cached,
              error: null,
            };
          }
        }

        setProjectError(result.error || 'Failed to load project.');
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [activeUserId, upsertProjectInState]
  );

  /**
   * Creates a new project (`POST /api/projects`).
   * If offline or a network error occurs, queues a durable `CREATE` operation
   * and caches the new project locally so the user can work on it immediately.
   */
  const createProject = useCallback(
    async (payload, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const {
          selectCreated = true,
          skipRefreshAfterMutation = false,
          ...apiOptions
        } = options || {};

        const trimmedName =
          payload && typeof payload.name === 'string'
            ? payload.name.trim()
            : '';
        if (!trimmedName) {
          const errMsg = 'Project name is required.';
          setProjectError(errMsg);
          return { ok: false, status: 400, project: null, error: errMsg };
        }

        const queueOfflineCreate = async () => {
          const nowIso = new Date().toISOString();
          const newId =
            payload && typeof payload.id === 'string' && payload.id.trim()
              ? payload.id.trim()
              : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          const optimisticProject = normalizeProjectRecord({
            ...(payload || {}),
            id: newId,
            userId: activeUserId,
            name: trimmedName,
            description:
              typeof payload.description === 'string'
                ? payload.description.trim()
                : '',
            version:
              typeof payload.version === 'string' && payload.version.trim()
                ? payload.version.trim()
                : '1.0.0',
            type:
              typeof payload.type === 'string' && payload.type.trim()
                ? payload.type.trim()
                : 'Web Application',
            environment:
              typeof payload.environment === 'string' &&
              payload.environment.trim()
                ? payload.environment.trim()
                : 'Staging',
            status: 'Active',
            testPlan: buildDefaultTestPlan({
              ...(payload || {}),
              id: newId,
              name: trimmedName,
            }),
            testSuites: Array.isArray(payload.testSuites)
              ? payload.testSuites
              : [],
            executionRuns: [],
            executions: [],
            defects: [],
            createdAt: nowIso,
            updatedAt: nowIso,
            _pendingSync: true,
            _pendingCreation: true,
          });

          const queuedOp = await queueProjectMutation({
            userId: activeUserId,
            projectId: newId,
            entityType: 'project',
            operationType: 'CREATE',
            payload: optimisticProject,
            expectedUpdatedAt: null,
            description: `Create project "${optimisticProject.name}"`,
          });

          setProjects((prev) => [
            optimisticProject,
            ...prev.filter((p) => p.id !== newId && p._id !== newId),
          ]);

          if (selectCreated !== false) {
            selectedProjectIdRef.current = newId;
            setSelectedProjectIdState(newId);
            await persistSelectedProjectId(newId);
          }

          await refreshSyncStatus();
          return {
            ok: true,
            status: 202,
            queuedOffline: true,
            project: optimisticProject,
            operation: queuedOp,
            error: null,
          };
        };

        if (isClientOffline() && activeUserId) {
          return await queueOfflineCreate();
        }

        const result = await createProjectApi(payload, apiOptions);

        if (result.ok && result.project) {
          const created = result.project;
          upsertProjectInState(created, {
            pendingSync: false,
            pendingCreation: false,
          });

          if (selectCreated !== false) {
            const newId = created.id || created._id;
            selectedProjectIdRef.current = newId;
            setSelectedProjectIdState(newId);
            await persistSelectedProjectId(newId);
          }

          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }

          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          return await queueOfflineCreate();
        }

        if (result.isConflict) {
          setConflictState({
            isConflict: true,
            projectId: result.projectId || (payload && payload.id) || null,
            currentUpdatedAt: result.currentUpdatedAt || null,
            expectedUpdatedAt: null,
            message: result.error,
          });
        }
        setProjectError(result.error || 'Failed to create project.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [
      activeUserId,
      upsertProjectInState,
      persistSelectedProjectId,
      refreshProjects,
      refreshSyncStatus,
    ]
  );

  /**
   * Updates project metadata via `PATCH /api/projects/:id` with optimistic
   * concurrency (`expectedUpdatedAt`) and offline queue fallback.
   */
  const updateProject = useCallback(
    async (projectId, updates = {}, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const existingProject = projectsRef.current.find(
          (p) => p.id === projectId || p._id === projectId
        );

        const {
          skipOptimisticConcurrency = false,
          skipRefreshAfterMutation = false,
          ...resolvedOptions
        } = options || {};

        const baselineUpdatedAt =
          (updates &&
            typeof updates.expectedUpdatedAt === 'string' &&
            updates.expectedUpdatedAt.trim()) ||
          (resolvedOptions &&
            typeof resolvedOptions.expectedUpdatedAt === 'string' &&
            resolvedOptions.expectedUpdatedAt.trim()) ||
          (existingProject &&
            (existingProject._serverUpdatedAt || existingProject.updatedAt)) ||
          null;

        if (!skipOptimisticConcurrency && baselineUpdatedAt) {
          resolvedOptions.expectedUpdatedAt = baselineUpdatedAt;
        }

        const queueOfflineUpdate = async () => {
          const optimisticProject = normalizeProjectRecord({
            ...(existingProject || { id: projectId }),
            ...(updates || {}),
            id: projectId,
            userId: activeUserId,
            updatedAt: baselineUpdatedAt || new Date().toISOString(),
            _serverUpdatedAt: baselineUpdatedAt,
            _pendingSync: true,
          });

          const queuedOp = await queueProjectMutation({
            userId: activeUserId,
            projectId,
            entityType: 'project',
            operationType: 'UPDATE',
            payload: updates,
            expectedUpdatedAt: baselineUpdatedAt,
            description: `Update project "${optimisticProject.name}" metadata`,
          });

          upsertProjectInState(optimisticProject, {
            pendingSync: true,
          });
          await refreshSyncStatus();

          return {
            ok: true,
            status: 202,
            queuedOffline: true,
            project: optimisticProject,
            operation: queuedOp,
            error: null,
          };
        };

        if (isClientOffline() && activeUserId) {
          return await queueOfflineUpdate();
        }

        const result = await updateProjectMetadataApi(
          projectId,
          updates,
          resolvedOptions
        );

        if (result.ok && result.project) {
          upsertProjectInState(result.project, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          return await queueOfflineUpdate();
        }

        if (result.isConflict) {
          setConflictState({
            isConflict: true,
            projectId,
            currentUpdatedAt: result.currentUpdatedAt || null,
            expectedUpdatedAt: result.expectedUpdatedAt || null,
            message: result.error,
          });
        }

        setProjectError(result.error || 'Failed to update project metadata.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [activeUserId, upsertProjectInState, refreshProjects, refreshSyncStatus]
  );

  /**
   * Updates project metadata via `PUT /api/projects/:id`.
   */
  const updateProjectPut = useCallback(
    async (projectId, updates = {}, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        if (isClientOffline() && activeUserId) {
          return await updateProject(projectId, updates, options);
        }

        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await updateProjectPutApi(projectId, updates, apiOptions);
        if (result.ok && result.project) {
          upsertProjectInState(result.project, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          return await updateProject(projectId, updates, options);
        }

        setProjectError(result.error || 'Failed to update project.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [activeUserId, updateProject, upsertProjectInState, refreshProjects]
  );

  /**
   * Updates a project's status (`Active` | `Completed` | `Archived`) via
   * `PATCH /api/projects/:id/status` with offline queue fallback.
   */
  const updateProjectStatus = useCallback(
    async (projectId, status, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const existingProject = projectsRef.current.find(
          (p) => p.id === projectId || p._id === projectId
        );

        const queueOfflineStatus = async () => {
          const optimisticProject = normalizeProjectRecord({
            ...(existingProject || { id: projectId, name: 'Project' }),
            status,
            _pendingSync: true,
          });
          const queuedOp = await queueProjectMutation({
            userId: activeUserId,
            projectId,
            entityType: 'project',
            operationType: 'STATUS_CHANGE',
            payload: { status },
            expectedUpdatedAt:
              (existingProject && existingProject.updatedAt) || null,
            description: `Change project status to ${status}`,
          });
          upsertProjectInState(optimisticProject, { pendingSync: true });
          await refreshSyncStatus();
          return {
            ok: true,
            status: 202,
            queuedOffline: true,
            project: optimisticProject,
            operation: queuedOp,
            error: null,
          };
        };

        if (isClientOffline() && activeUserId) {
          return await queueOfflineStatus();
        }

        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await updateProjectStatusApi(
          projectId,
          status,
          apiOptions
        );
        if (result.ok && result.project) {
          upsertProjectInState(result.project, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          return await queueOfflineStatus();
        }

        setProjectError(result.error || 'Failed to update project status.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [activeUserId, upsertProjectInState, refreshProjects, refreshSyncStatus]
  );

  /**
   * Updates nested project QA data (`testPlan`, `testSuites`, `executionRuns`,
   * `executions`, `defects`, summary counts) via `PATCH /api/projects/:id/data`
   * with optimistic concurrency (`expectedUpdatedAt`) and durable offline queueing.
   */
  const updateProjectData = useCallback(
    async (projectId, dataUpdates = {}, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const existingProject = projectsRef.current.find(
          (p) => p.id === projectId || p._id === projectId
        );

        const {
          skipOptimisticConcurrency = false,
          skipRefreshAfterMutation = true,
          entityType = 'data',
          description = '',
          deletionTombstones = null,
          ...resolvedOptions
        } = options || {};

        const baselineUpdatedAt =
          (dataUpdates &&
            typeof dataUpdates.expectedUpdatedAt === 'string' &&
            dataUpdates.expectedUpdatedAt.trim()) ||
          (resolvedOptions &&
            typeof resolvedOptions.expectedUpdatedAt === 'string' &&
            resolvedOptions.expectedUpdatedAt.trim()) ||
          (existingProject &&
            (existingProject._serverUpdatedAt || existingProject.updatedAt)) ||
          null;

        if (!skipOptimisticConcurrency && baselineUpdatedAt) {
          resolvedOptions.expectedUpdatedAt = baselineUpdatedAt;
        }

        const queueOfflineDataUpdate = async () => {
          const optimisticProject = normalizeProjectRecord({
            ...(existingProject || { id: projectId, name: 'Project' }),
            ...(dataUpdates || {}),
            id: projectId,
            userId: activeUserId,
            updatedAt: baselineUpdatedAt || new Date().toISOString(),
            _serverUpdatedAt: baselineUpdatedAt,
            _pendingSync: true,
          });

          const queuedOp = await queueProjectMutation({
            userId: activeUserId,
            projectId,
            entityType: entityType || 'data',
            operationType: 'UPDATE',
            payload: dataUpdates,
            expectedUpdatedAt: baselineUpdatedAt,
            deletionTombstones,
            description:
              description ||
              `Update QA workspace data (${Object.keys(dataUpdates || {})
                .slice(0, 3)
                .join(', ')})`,
          });

          upsertProjectInState(optimisticProject, {
            pendingSync: true,
          });
          await refreshSyncStatus();

          return {
            ok: true,
            status: 202,
            queuedOffline: true,
            project: optimisticProject,
            operation: queuedOp,
            error: null,
          };
        };

        if (isClientOffline() && activeUserId) {
          return await queueOfflineDataUpdate();
        }

        const result = await updateProjectDataApi(
          projectId,
          dataUpdates,
          resolvedOptions
        );

        if (result.ok && result.project) {
          upsertProjectInState(result.project, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        if (
          activeUserId &&
          (result.isNetworkError || result.status === 0)
        ) {
          return await queueOfflineDataUpdate();
        }

        if (result.isConflict) {
          setConflictState({
            isConflict: true,
            projectId,
            currentUpdatedAt: result.currentUpdatedAt || null,
            expectedUpdatedAt: result.expectedUpdatedAt || null,
            message: result.error,
          });
        }

        setProjectError(result.error || 'Failed to save project QA data.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [activeUserId, upsertProjectInState, refreshProjects, refreshSyncStatus]
  );

  /**
   * Deletes a project via `DELETE /api/projects/:id`.
   * If offline or a network error occurs, queues a durable `DELETE` operation
   * (or cancels out an unsynced offline `CREATE`) and removes the project from state.
   */
  const deleteProject = useCallback(
    async (projectId, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const removeProjectFromLocalState = async () => {
          const currentSelected = selectedProjectIdRef.current;
          const targetWasSelected =
            currentSelected === projectId ||
            projectsRef.current.some(
              (p) =>
                (p.id === projectId || p._id === projectId) &&
                (p.id === currentSelected || p._id === currentSelected)
            );

          const remaining = projectsRef.current.filter(
            (p) => p.id !== projectId && p._id !== projectId
          );
          setProjects(remaining);
          if (activeUserId) {
            await removeCachedProjectOffline(projectId, activeUserId);
          }

          if (targetWasSelected) {
            selectedProjectIdRef.current = null;
            setSelectedProjectIdState(null);
            await persistSelectedProjectId(null);
          }
        };

        const queueOfflineDelete = async () => {
          const queuedOp = await queueProjectMutation({
            userId: activeUserId,
            projectId,
            entityType: 'project',
            operationType: 'DELETE',
            payload: { id: projectId },
            description: `Delete project (${projectId})`,
          });
          await removeProjectFromLocalState();
          await refreshSyncStatus();
          return {
            ok: true,
            status: 202,
            queuedOffline: true,
            deletedProjectId: projectId,
            operation: queuedOp,
            error: null,
          };
        };

        if (isClientOffline() && activeUserId) {
          return await queueOfflineDelete();
        }

        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await deleteProjectApi(projectId, apiOptions);
        if (!result.ok) {
          if (
            activeUserId &&
            (result.isNetworkError || result.status === 0)
          ) {
            return await queueOfflineDelete();
          }
          setProjectError(result.error || 'Failed to delete project.');
          return result;
        }

        await removeProjectFromLocalState();

        if (!skipRefreshAfterMutation) {
          await refreshProjects({ silent: true });
        }

        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [activeUserId, persistSelectedProjectId, refreshProjects, refreshSyncStatus]
  );

  /**
   * Resolves a queued HTTP 409 conflict (`'merge'`, `'keep_local'`, `'keep_server'`, `'discard_local'`)
   * and refreshes project state.
   */
  const resolveSyncConflict = useCallback(
    async (opId, resolution, options = {}) => {
      if (!activeUserId) {
        return { ok: false, error: 'Authentication required.' };
      }
      const res = await resolveProjectConflict(
        opId,
        resolution,
        activeUserId,
        options
      );
      if (res.ok && res.project) {
        upsertProjectInState(res.project, {
          pendingSync: false,
          pendingCreation: false,
        });
      }
      await refreshSyncStatus();
      if (!isClientOffline()) {
        await refreshProjects({ silent: true });
      }
      return res;
    },
    [activeUserId, upsertProjectInState, refreshSyncStatus, refreshProjects]
  );

  /**
   * Retries a single queued or failed operation.
   */
  const retrySyncOperation = useCallback(
    async (opId, options = {}) => {
      if (!activeUserId) {
        return { ok: false, error: 'Authentication required.' };
      }
      const res = await retryProjectOperation(opId, activeUserId, options);
      await refreshSyncStatus();
      if (res.ok && !isClientOffline()) {
        await refreshProjects({ silent: true });
      }
      return res;
    },
    [activeUserId, refreshSyncStatus, refreshProjects]
  );

  /**
   * Retries all failed operations in the user's sync queue.
   */
  const retryAllFailedOperations = useCallback(
    async (options = {}) => {
      if (!activeUserId) {
        return { ok: false, error: 'Authentication required.' };
      }
      const res = await retryFailedProjectOperations(activeUserId, options);
      await refreshSyncStatus();
      if (res.ok && !isClientOffline()) {
        await refreshProjects({ silent: true });
      }
      return res;
    },
    [activeUserId, refreshSyncStatus, refreshProjects]
  );

  /**
   * Discards a single operation from the user's sync queue.
   */
  const discardSyncOperation = useCallback(
    async (opId) => {
      if (!activeUserId) {
        return { ok: false, error: 'Authentication required.' };
      }
      const res = await discardProjectOperation(opId, activeUserId);
      await refreshSyncStatus();
      return res;
    },
    [activeUserId, refreshSyncStatus]
  );

  /**
   * Toggles simulated offline mode on/off and automatically synchronizes queued
   * operations when switching back online.
   */
  const toggleSimulatedOfflineMode = useCallback(
    async (nextOffline) => {
      const targetOffline =
        typeof nextOffline === 'boolean'
          ? nextOffline
          : !syncStatus.simulatedOffline;
      setSimulatedOfflineMode(targetOffline, { skipAutoReconnect: true });
      await refreshSyncStatus();
      if (!targetOffline && activeUserId && !isClientOffline()) {
        const syncRes = await triggerReconnectSyncForUser(activeUserId, {
          source: 'simulated_toggle',
        });
        await refreshSyncStatus();
        await refreshProjects({ silent: true });
        return { online: true, syncResult: syncRes };
      }
      return { online: !isClientOffline() };
    },
    [
      syncStatus.simulatedOffline,
      activeUserId,
      refreshSyncStatus,
      refreshProjects,
    ]
  );

  const selectedProject = useMemo(() => {
    if (!selectedProjectId || !projects.length) return null;
    return (
      projects.find(
        (p) => p.id === selectedProjectId || p._id === selectedProjectId
      ) || null
    );
  }, [projects, selectedProjectId]);

  const value = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedProjectId: selectedProject
        ? selectedProject.id || selectedProject._id
        : null,
      projectStatuses: PROJECT_STATUSES,
      hasLoadedInitialProjects,
      isLoading,
      isRefreshing,
      isMutating,
      projectError,
      conflictState,
      syncStatus,
      isOffline: !syncStatus.online,
      selectProject,
      clearSelectedProject,
      refreshProjects,
      getProject,
      createProject,
      updateProject,
      updateProjectPut,
      updateProjectStatus,
      updateProjectData,
      deleteProject,
      clearProjectError,
      refreshSyncStatus,
      syncOfflineQueue,
      resolveSyncConflict,
      retrySyncOperation,
      retryAllFailedOperations,
      discardSyncOperation,
      toggleSimulatedOfflineMode,
    }),
    [
      projects,
      selectedProject,
      hasLoadedInitialProjects,
      isLoading,
      isRefreshing,
      isMutating,
      projectError,
      conflictState,
      syncStatus,
      selectProject,
      clearSelectedProject,
      refreshProjects,
      getProject,
      createProject,
      updateProject,
      updateProjectPut,
      updateProjectStatus,
      updateProjectData,
      deleteProject,
      clearProjectError,
      refreshSyncStatus,
      syncOfflineQueue,
      resolveSyncConflict,
      retrySyncOperation,
      retryAllFailedOperations,
      discardSyncOperation,
      toggleSimulatedOfflineMode,
    ]
  );

  return React.createElement(
    ProjectContext.Provider,
    { value },
    children
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return context;
}

export default ProjectContext;

/**
 * Qavora Android — Dedicated Multi-Project State Architecture (Phase 2A + 2B)
 *
 * Manages multiple projects belonging to the authenticated user against the
 * Qavora Web Express 5 + MongoDB 7 backend (`/api/projects*`):
 * - Project list (`projects`) & status filtering
 * - Currently selected project (`selectedProjectId`, `selectedProject`), persisted
 *   per user across app restarts in AsyncStorage (`@qavora_selected_project_id_v1:<userId>`)
 * - Loading, mutation, error, and HTTP 409 optimistic concurrency conflict states
 * - Creating a project (`POST /api/projects`) + refreshing project list
 * - Updating project metadata (`PATCH /api/projects/:id` with `expectedUpdatedAt`,
 *   and `PUT /api/projects/:id`) + refreshing project list
 * - Updating project status (`PATCH /api/projects/:id/status`) + refreshing project list
 * - Deleting a project (`DELETE /api/projects/:id`), clearing `selectedProject`
 *   when the currently selected project is deleted + refreshing project list
 * - Refreshing project list and individual project records from the backend
 *
 * Kept strictly separate from authentication logic (`AuthContext.js`) and
 * existing workspace UI state (`WorkspaceContext.js`).
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
  deleteProject as deleteProjectApi,
} from '../services/projectService.js';

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

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedProjectIdRef.current = selectedProjectId;

  const clearProjectError = useCallback(() => {
    setProjectError(null);
    setConflictState(null);
  }, []);

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
   * Synchronizes a single updated or hydrated project into the `projects` list.
   */
  const upsertProjectInState = useCallback((projectRecord) => {
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
  }, []);

  /**
   * Fetches all projects belonging to the authenticated user (`GET /api/projects`).
   * Restores the persisted `selectedProjectId` if it exists in the fetched list;
   * clears `selectedProjectId` if the stored project no longer exists on the backend.
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

      if (!isSilent) {
        if (isPullRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setProjectError(null);
      }

      try {
        const { silent: _s, pullToRefresh: _p, autoSelectFirst, ...apiOptions } =
          options || {};
        const result = await fetchProjects(apiOptions);

        if (!result.ok) {
          if (!isSilent) {
            setProjectError(result.error || 'Failed to load projects.');
          }
          return result;
        }

        const loadedProjects = Array.isArray(result.projects)
          ? result.projects
          : [];
        setProjects(loadedProjects);

        // Reconcile selectedProjectId with in-memory or persisted selection
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

        return result;
      } finally {
        setHasLoadedInitialProjects(true);
        if (!isSilent) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [isAuthenticated, activeUserId, persistSelectedProjectId]
  );

  // Automatically load user projects when authenticated user session becomes active;
  // clear project state when logged out or when user changes.
  useEffect(() => {
    let mounted = true;

    if (!isAuthenticated || !activeUserId) {
      setProjects([]);
      selectedProjectIdRef.current = null;
      setSelectedProjectIdState(null);
      setHasLoadedInitialProjects(false);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsMutating(false);
      setProjectError(null);
      setConflictState(null);
      return () => {
        mounted = false;
      };
    }

    // Reset in-memory selection before loading the active user's persisted selection
    selectedProjectIdRef.current = null;
    setSelectedProjectIdState(null);
    setHasLoadedInitialProjects(false);

    (async () => {
      if (!mounted) return;
      await refreshProjects();
    })();

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, activeUserId, refreshProjects]);

  /**
   * Fetches an individual project by ID (`GET /api/projects/:id`) and updates state.
   */
  const getProject = useCallback(
    async (projectId, options = {}) => {
      setIsLoading(true);
      setProjectError(null);

      try {
        const result = await fetchProjectById(projectId, options);
        if (result.ok && result.project) {
          upsertProjectInState(result.project);
        } else if (!result.ok) {
          setProjectError(result.error || 'Failed to load project.');
        }
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [upsertProjectInState]
  );

  /**
   * Creates a new project (`POST /api/projects`), prepends it to state,
   * selects it by default unless `options.selectCreated === false`,
   * and refreshes the project list from the backend.
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
        const result = await createProjectApi(payload, apiOptions);

        if (result.ok && result.project) {
          const created = result.project;
          setProjects((prev) => {
            const exists = prev.some(
              (p) => p.id === created.id || p._id === created._id
            );
            return exists
              ? prev.map((p) =>
                  p.id === created.id || p._id === created._id ? created : p
                )
              : [created, ...prev];
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
    [persistSelectedProjectId, refreshProjects]
  );

  /**
   * Updates project metadata via `PATCH /api/projects/:id` with optimistic
   * concurrency (`expectedUpdatedAt`) and refreshes the project list.
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

        const hasExplicitExpected =
          (updates &&
            typeof updates.expectedUpdatedAt === 'string' &&
            updates.expectedUpdatedAt.trim()) ||
          (resolvedOptions &&
            typeof resolvedOptions.expectedUpdatedAt === 'string' &&
            resolvedOptions.expectedUpdatedAt.trim());

        if (
          !hasExplicitExpected &&
          !skipOptimisticConcurrency &&
          existingProject &&
          existingProject.updatedAt
        ) {
          resolvedOptions.expectedUpdatedAt = existingProject.updatedAt;
        }

        const result = await updateProjectMetadataApi(
          projectId,
          updates,
          resolvedOptions
        );

        if (result.ok && result.project) {
          upsertProjectInState(result.project);
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
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
    [upsertProjectInState, refreshProjects]
  );

  /**
   * Updates project metadata via `PUT /api/projects/:id` and refreshes the project list.
   */
  const updateProjectPut = useCallback(
    async (projectId, updates = {}, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await updateProjectPutApi(projectId, updates, apiOptions);
        if (result.ok && result.project) {
          upsertProjectInState(result.project);
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        setProjectError(result.error || 'Failed to update project.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [upsertProjectInState, refreshProjects]
  );

  /**
   * Updates a project's status (`Active` | `Completed` | `Archived`) via
   * `PATCH /api/projects/:id/status` and refreshes the project list.
   */
  const updateProjectStatus = useCallback(
    async (projectId, status, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await updateProjectStatusApi(
          projectId,
          status,
          apiOptions
        );
        if (result.ok && result.project) {
          upsertProjectInState(result.project);
          if (!skipRefreshAfterMutation) {
            await refreshProjects({ silent: true });
          }
          return result;
        }

        setProjectError(result.error || 'Failed to update project status.');
        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [upsertProjectInState, refreshProjects]
  );

  /**
   * Deletes a project via `DELETE /api/projects/:id`.
   * Explicitly clears `selectedProjectId` if the deleted project was selected,
   * and refreshes the project list.
   */
  const deleteProject = useCallback(
    async (projectId, options = {}) => {
      setIsMutating(true);
      setProjectError(null);
      setConflictState(null);

      try {
        const { skipRefreshAfterMutation = false, ...apiOptions } =
          options || {};
        const result = await deleteProjectApi(projectId, apiOptions);
        if (!result.ok) {
          setProjectError(result.error || 'Failed to delete project.');
          return result;
        }

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

        if (targetWasSelected) {
          selectedProjectIdRef.current = null;
          setSelectedProjectIdState(null);
          await persistSelectedProjectId(null);
        }

        if (!skipRefreshAfterMutation) {
          await refreshProjects({ silent: true });
        }

        return result;
      } finally {
        setIsMutating(false);
      }
    },
    [persistSelectedProjectId, refreshProjects]
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
      selectProject,
      clearSelectedProject,
      refreshProjects,
      getProject,
      createProject,
      updateProject,
      updateProjectPut,
      updateProjectStatus,
      deleteProject,
      clearProjectError,
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
      selectProject,
      clearSelectedProject,
      refreshProjects,
      getProject,
      createProject,
      updateProject,
      updateProjectPut,
      updateProjectStatus,
      deleteProject,
      clearProjectError,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
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

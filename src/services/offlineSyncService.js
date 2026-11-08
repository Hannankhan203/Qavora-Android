/**
 * Qavora Android — Offline-First Cache & Synchronization Engine (Phases 2F & 3A)
 *
 * Implements parity with Qavora Web's `src/modules/qaChecklistSyncQueue.js`
 * for React Native / Expo using per-user AsyncStorage persistence and native
 * Android / iOS / Web network monitoring (`@react-native-community/netinfo`):
 * 1. Per-User Offline Project Cache (`@qavora_offline_projects_cache_v1:<userId>`)
 * 2. Durable Per-User Offline Mutation Queue (`@qavora_pending_project_ops_v1:<userId>`)
 * 3. Idempotent Operation Coalescing & Dependency Ordering
 * 4. In-Memory + Persistent TTL Sync Lock (`@qavora_sync_locks_v1:<userId>`) with
 *    Generation Ownership Verification (`dequeueProjectOperationIfLockValid`)
 * 5. Chained `expectedUpdatedAt` Advancement Across Same-Project Operations
 * 6. Safe HTTP 409 Conflict Capture & Explicit Resolution (`merge` / `keep_local`
 *    vs `keep_server` / `discard_local`)
 * 7. Strict Multi-User Isolation & Logout Preservation
 * 8. Native Android (`@react-native-community/netinfo`) + Web (`window` online/offline)
 *    + `AppState` Connectivity Monitoring with Offline-to-Online Transition Deduplication
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  fetchProjectById,
  createProject as createProjectApi,
  updateProjectMetadata as updateProjectMetadataApi,
  updateProjectStatus as updateProjectStatusApi,
  updateProjectData as updateProjectDataApi,
  deleteProject as deleteProjectApi,
  normalizeProjectRecord,
} from './projectService.js';

export const OFFLINE_PROJECTS_CACHE_PREFIX = '@qavora_offline_projects_cache_v1:';
export const PENDING_PROJECT_OPS_PREFIX = '@qavora_pending_project_ops_v1:';
export const SYNC_LOCK_STORAGE_PREFIX = '@qavora_sync_locks_v1:';

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const DEFAULT_MAX_RETRIES = 5;
const SYNC_LOCK_TTL_MS = 45000;
const DEFAULT_RECONNECT_DEBOUNCE_MS = 60;

const INITIAL_NETWORK_STATE = {
  type: 'unknown',
  isConnected: null,
  isInternetReachable: null,
  isOnline: true,
  isKnown: false,
  reason: 'initial',
  details: null,
  updatedAt: null,
};

let customSyncStorageAdapter = null;
let customNetInfoAdapter = null;
let customAppStateAdapter = null;
let simulatedOfflineMode = false;
let monotonicSeqCounter = 0;
let reconnectDebounceMs = DEFAULT_RECONNECT_DEBOUNCE_MS;

// Tracks the currently authenticated user ID so User A's queue is never synced while User B is active
let activeAuthenticatedUserId = null;

// Tracks normalized native + web network state
let networkConnectivityState = { ...INITIAL_NETWORK_STATE };

// Subscription & debounce management for native NetInfo + web window + AppState
let connectivityMonitorRefCount = 0;
let netInfoUnsubscribe = null;
let windowOnlineHandler = null;
let windowOfflineHandler = null;
let appStateSubscription = null;
let lastKnownAppState =
  AppState && typeof AppState.currentState === 'string'
    ? AppState.currentState
    : 'active';
let pendingReconnectTimer = null;
let pendingReconnectUserId = null;

// Single-flight reconnect promise registry keyed by userId
const activeReconnectSyncPromises = new Map();
// Optional callback invoked when an automatic reconnect sync finishes
const reconnectSyncCallbacks = new Set();

// In-memory lock registry keyed by userId
const activeMemoryLocks = new Map();
// Listeners notified whenever queue or online/sync status changes
const syncStatusListeners = new Set();

function getStorage() {
  if (customSyncStorageAdapter) {
    return customSyncStorageAdapter;
  }
  return AsyncStorage;
}

function getNetInfo() {
  if (customNetInfoAdapter) {
    return customNetInfoAdapter;
  }
  return NetInfo;
}

function getAppStateModule() {
  if (customAppStateAdapter) {
    return customAppStateAdapter;
  }
  return AppState;
}

/**
 * Injects a custom storage adapter for deterministic Node verification tests.
 *
 * @param {object | null} adapter
 */
export function setOfflineSyncStorageAdapter(adapter) {
  customSyncStorageAdapter = adapter;
}

/**
 * Injects a custom NetInfo adapter (`fetch`, `addEventListener`, `refresh`) for
 * deterministic connectivity verification tests.
 *
 * @param {object | null} adapter
 */
export function setNetInfoAdapterForTesting(adapter) {
  customNetInfoAdapter = adapter;
}

/**
 * Injects a custom AppState adapter (`currentState`, `addEventListener`) for
 * deterministic foreground/background transition tests.
 *
 * @param {object | null} adapter
 */
export function setAppStateAdapterForTesting(adapter) {
  customAppStateAdapter = adapter;
  if (adapter && typeof adapter.currentState === 'string') {
    lastKnownAppState = adapter.currentState;
  }
}

/**
 * Configures the reconnect debounce window (ms) for rapid network transition coalescing.
 *
 * @param {number} ms
 */
export function setReconnectDebounceMsForTesting(ms) {
  reconnectDebounceMs =
    typeof ms === 'number' && ms >= 0 ? ms : DEFAULT_RECONNECT_DEBOUNCE_MS;
}

/**
 * Resets internal connectivity tracking state to initial defaults (used in test suites).
 */
export function resetConnectivityStateForTesting() {
  clearPendingReconnectTimer();
  activeReconnectSyncPromises.clear();
  networkConnectivityState = { ...INITIAL_NETWORK_STATE };
  simulatedOfflineMode = false;
  lastKnownAppState = 'active';
}

/**
 * Registers the currently authenticated user ID so background/reconnection sync
 * strictly enforces per-user isolation and never syncs User A's queue while User B
 * is authenticated.
 *
 * @param {string | null} userId
 */
export function setActiveSyncUser(userId) {
  const cleanUser =
    typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  const previousUser = activeAuthenticatedUserId;
  activeAuthenticatedUserId = cleanUser;

  if (previousUser && previousUser !== cleanUser) {
    if (pendingReconnectUserId === previousUser) {
      clearPendingReconnectTimer();
    }
  }
}

/**
 * Returns the currently registered authenticated user ID for synchronization.
 *
 * @returns {string | null}
 */
export function getActiveSyncUser() {
  return activeAuthenticatedUserId;
}

/**
 * Returns a copy of the current normalized network connectivity state.
 *
 * @returns {object}
 */
export function getNetworkConnectivityState() {
  return {
    ...networkConnectivityState,
    simulatedOffline: simulatedOfflineMode,
    effectiveOnline: !isClientOffline(),
  };
}

function isBrowserNavigatorOffline() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.onLine === 'boolean' &&
    navigator.onLine === false
  );
}

/**
 * Evaluates a raw NetInfo state snapshot (or browser event) into a normalized
 * connectivity state.
 *
 * Rules:
 * 1. `type === 'none'` or `isConnected === false` -> Offline (`reason: 'disconnected'`)
 * 2. `isConnected === true` AND `isInternetReachable === false` -> Offline
 *    (`reason: 'internet_unreachable'`, internet unavailable despite active Wi-Fi/cellular)
 * 3. `type === 'unknown'` or `isConnected === null` -> Unknown state (`reason: 'unknown'`);
 *    preserves last known `isOnline` state without triggering false transitions
 * 4. `isConnected === true` AND `isInternetReachable !== false` -> Online (`reason: 'online'`,
 *    unless browser `navigator.onLine === false`)
 *
 * @param {object | null | undefined} rawState
 * @param {object} prevState
 * @returns {object}
 */
export function evaluateNetInfoState(rawState, prevState = networkConnectivityState) {
  const safePrev = prevState || INITIAL_NETWORK_STATE;
  const nowIso = new Date().toISOString();

  if (!rawState || typeof rawState !== 'object') {
    const fallbackOnline = safePrev.isKnown
      ? safePrev.isOnline
      : !isBrowserNavigatorOffline();
    return {
      ...safePrev,
      type: 'unknown',
      isConnected: null,
      isInternetReachable: null,
      isOnline: fallbackOnline,
      isKnown: safePrev.isKnown,
      reason: 'unknown',
      updatedAt: nowIso,
    };
  }

  const normalizedType = String(rawState.type || 'unknown')
    .trim()
    .toLowerCase();
  const isConnected =
    typeof rawState.isConnected === 'boolean' ? rawState.isConnected : null;
  const isInternetReachable =
    typeof rawState.isInternetReachable === 'boolean'
      ? rawState.isInternetReachable
      : null;

  // 1. Explicitly disconnected (`none` or `isConnected === false`)
  if (normalizedType === 'none' || isConnected === false) {
    return {
      type: normalizedType === 'unknown' ? 'none' : normalizedType,
      isConnected: false,
      isInternetReachable: false,
      isOnline: false,
      isKnown: true,
      reason: 'disconnected',
      details: rawState.details || null,
      updatedAt: nowIso,
    };
  }

  // 2. Active Wi-Fi / Cellular connection, but internet is explicitly unreachable
  if (isConnected === true && isInternetReachable === false) {
    return {
      type: normalizedType,
      isConnected: true,
      isInternetReachable: false,
      isOnline: false,
      isKnown: true,
      reason: 'internet_unreachable',
      details: rawState.details || null,
      updatedAt: nowIso,
    };
  }

  // 3. Unknown / transitional state (`type === 'unknown'` or `isConnected === null`)
  if (normalizedType === 'unknown' || isConnected === null) {
    const preservedOnline = safePrev.isKnown
      ? safePrev.isOnline
      : !isBrowserNavigatorOffline();
    return {
      type: 'unknown',
      isConnected: null,
      isInternetReachable,
      isOnline: preservedOnline,
      isKnown: safePrev.isKnown,
      reason: 'unknown',
      details: rawState.details || null,
      updatedAt: nowIso,
    };
  }

  // 4. Connected (`wifi`, `cellular`, `ethernet`, `vpn`, `other`) and internet is not unreachable
  if (isBrowserNavigatorOffline()) {
    return {
      type: normalizedType,
      isConnected: true,
      isInternetReachable: false,
      isOnline: false,
      isKnown: true,
      reason: 'browser_offline',
      details: rawState.details || null,
      updatedAt: nowIso,
    };
  }

  return {
    type: normalizedType,
    isConnected: true,
    isInternetReachable,
    isOnline: true,
    isKnown: true,
    reason: 'online',
    details: rawState.details || null,
    updatedAt: nowIso,
  };
}

function clearPendingReconnectTimer() {
  if (pendingReconnectTimer !== null) {
    clearTimeout(pendingReconnectTimer);
    pendingReconnectTimer = null;
  }
  pendingReconnectUserId = null;
}

/**
 * Registers a callback invoked whenever an automatic connectivity-restored sync
 * pass completes for the active user.
 *
 * @param {(result: object) => void} callback
 * @returns {() => void}
 */
export function subscribeToReconnectSyncResults(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  reconnectSyncCallbacks.add(callback);
  return () => {
    reconnectSyncCallbacks.delete(callback);
  };
}

function notifyReconnectSyncCallbacks(payload) {
  reconnectSyncCallbacks.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      // Ignore callback errors
    }
  });
}

/**
 * Executes a single-flight reconnect synchronization pass for `userId`.
 * If a reconnect sync or manual sync is already running for `userId`, returns
 * the existing promise or skips without spawning duplicate backend requests.
 *
 * @param {string} userId
 * @param {object} [meta]
 * @returns {Promise<object>}
 */
export async function triggerReconnectSyncForUser(userId, meta = {}) {
  const targetUserId = String(userId || activeAuthenticatedUserId || '').trim();
  if (!targetUserId) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'missing_user_id',
      updatedProjects: [],
    };
  }

  // Enforce strict user isolation: never sync User A's queue while User B is authenticated
  if (
    activeAuthenticatedUserId !== null &&
    targetUserId !== activeAuthenticatedUserId
  ) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'user_mismatch',
      updatedProjects: [],
    };
  }

  if (isClientOffline()) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'offline',
      updatedProjects: [],
    };
  }

  // If a reconnect sync promise is already in flight for this user, reuse it
  const existingPromise = activeReconnectSyncPromises.get(targetUserId);
  if (existingPromise) {
    return existingPromise;
  }

  // If a manual sync already holds the memory lock for this user, do not start a duplicate pass
  const existingLock = activeMemoryLocks.get(targetUserId);
  if (existingLock && existingLock.expiresAt > Date.now()) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'already_syncing',
      updatedProjects: [],
    };
  }

  const syncPromise = (async () => {
    try {
      const res = await processProjectSyncQueue(targetUserId, {
        ignoreBackoff: true,
        triggerSource: meta.source || 'auto_reconnect',
      });
      notifyReconnectSyncCallbacks({
        userId: targetUserId,
        result: res,
        meta,
      });
      return res;
    } finally {
      if (activeReconnectSyncPromises.get(targetUserId) === syncPromise) {
        activeReconnectSyncPromises.delete(targetUserId);
      }
    }
  })();

  activeReconnectSyncPromises.set(targetUserId, syncPromise);
  return syncPromise;
}

/**
 * Schedules a coalesced automatic reconnect sync for the active authenticated user.
 * Rapid offline/online transitions within `reconnectDebounceMs` are coalesced into
 * a single execution, and cancelled immediately if the device drops back offline
 * before execution begins.
 *
 * @param {object} [meta]
 */
function scheduleAutoReconnectSync(meta = {}) {
  const targetUserId = activeAuthenticatedUserId;
  if (!targetUserId || isClientOffline()) {
    return;
  }

  // If a sync lock is already active for this user, skip scheduling a duplicate timer
  const existingLock = activeMemoryLocks.get(targetUserId);
  if (
    activeReconnectSyncPromises.has(targetUserId) ||
    (existingLock && existingLock.expiresAt > Date.now())
  ) {
    return;
  }

  clearPendingReconnectTimer();
  pendingReconnectUserId = targetUserId;

  if (reconnectDebounceMs <= 0) {
    pendingReconnectUserId = null;
    triggerReconnectSyncForUser(targetUserId, meta).catch(() => {});
    return;
  }

  pendingReconnectTimer = setTimeout(() => {
    const scheduledUser = pendingReconnectUserId;
    pendingReconnectTimer = null;
    pendingReconnectUserId = null;

    if (
      !scheduledUser ||
      scheduledUser !== activeAuthenticatedUserId ||
      isClientOffline()
    ) {
      return;
    }
    triggerReconnectSyncForUser(scheduledUser, meta).catch(() => {});
  }, reconnectDebounceMs);
}

/**
 * Applies a raw connectivity state update from NetInfo, Web `window` online/offline,
 * or `AppState` foreground checks, detects true offline-to-online transitions,
 * and triggers automatic queue synchronization without duplicate calls.
 *
 * @param {object | null | undefined} rawState
 * @param {string} [source]
 * @returns {object}
 */
export function handleConnectivityStateChange(rawState, source = 'netinfo') {
  const hadKnownState = networkConnectivityState.isKnown;
  const wasOffline = isClientOffline();
  const prevType = networkConnectivityState.type;
  const prevReachable = networkConnectivityState.isInternetReachable;

  const nextState = evaluateNetInfoState(rawState, networkConnectivityState);
  networkConnectivityState = nextState;

  const nowOffline = isClientOffline();

  // Safe handling of unknown connectivity states: never trigger false transitions
  if (nextState.reason === 'unknown') {
    if (nowOffline) {
      clearPendingReconnectTimer();
    }
    notifySyncListeners({
      type: 'connectivity_unknown',
      source,
      connectionType: nextState.type,
      networkState: getNetworkConnectivityState(),
    });
    return getNetworkConnectivityState();
  }

  // Transition 1: Offline -> Online (or initial check confirming online with pending ops)
  if (wasOffline && !nowOffline) {
    notifySyncListeners({
      type: 'online',
      transition: 'offline_to_online',
      source,
      connectionType: nextState.type,
      networkState: getNetworkConnectivityState(),
    });
    scheduleAutoReconnectSync({
      source,
      connectionType: nextState.type,
      transition: 'offline_to_online',
    });
    return getNetworkConnectivityState();
  }

  // Transition 2: Online -> Offline (including active network with isInternetReachable: false)
  if (!wasOffline && nowOffline) {
    clearPendingReconnectTimer();
    notifySyncListeners({
      type: 'offline',
      transition: 'online_to_offline',
      source,
      connectionType: nextState.type,
      reason: nextState.reason,
      networkState: getNetworkConnectivityState(),
    });
    return getNetworkConnectivityState();
  }

  // Transition 3: Initial connectivity check confirmed online from startup
  if (!hadKnownState && nextState.isKnown && !nowOffline) {
    notifySyncListeners({
      type: 'connectivity_initialized',
      source,
      connectionType: nextState.type,
      networkState: getNetworkConnectivityState(),
    });
    return getNetworkConnectivityState();
  }

  // Transition 4: Already online, interface changed (e.g., wifi <-> cellular handover)
  if (
    !nowOffline &&
    (prevType !== nextState.type || prevReachable !== nextState.isInternetReachable)
  ) {
    notifySyncListeners({
      type: 'connectivity_changed',
      transition: 'none',
      source,
      connectionType: nextState.type,
      networkState: getNetworkConnectivityState(),
    });
  }

  return getNetworkConnectivityState();
}

/**
 * Performs an explicit connectivity check using `NetInfo.fetch()` (with browser
 * fallback if native NetInfo is unavailable). Called automatically when the app starts
 * and on foreground transitions.
 *
 * @param {string} [source]
 * @returns {Promise<object>}
 */
export async function checkInitialConnectivity(source = 'initial_check') {
  try {
    const netInfo = getNetInfo();
    if (netInfo && typeof netInfo.fetch === 'function') {
      const state = await netInfo.fetch();
      return handleConnectivityStateChange(state, source);
    }
  } catch {
    // Fall back to browser navigator.onLine if NetInfo.fetch throws
  }

  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return handleConnectivityStateChange(
      {
        type: navigator.onLine ? 'other' : 'none',
        isConnected: navigator.onLine,
        isInternetReachable: navigator.onLine,
      },
      `${source}_navigator_fallback`
    );
  }

  return getNetworkConnectivityState();
}

/**
 * Starts reference-counted native Android/iOS (`@react-native-community/netinfo`),
 * Web (`window.addEventListener('online' / 'offline')`), and React Native `AppState`
 * connectivity monitoring.
 *
 * Returns an unsubscribe cleanup function. When all subscribers have cleaned up,
 * all native and web listeners and timers are removed.
 *
 * @returns {() => void}
 */
export function startConnectivityMonitoring() {
  connectivityMonitorRefCount += 1;

  if (connectivityMonitorRefCount === 1) {
    // 1. Native / Cross-Platform NetInfo Subscription
    try {
      const netInfo = getNetInfo();
      if (netInfo && typeof netInfo.addEventListener === 'function') {
        netInfoUnsubscribe = netInfo.addEventListener((state) => {
          handleConnectivityStateChange(state, 'netinfo_listener');
        });
      }
    } catch {
      netInfoUnsubscribe = null;
    }

    // 2. Preserve Web online/offline listeners (`window.addEventListener`)
    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      windowOnlineHandler = () => {
        handleConnectivityStateChange(
          {
            type:
              networkConnectivityState.type &&
              networkConnectivityState.type !== 'none' &&
              networkConnectivityState.type !== 'unknown'
                ? networkConnectivityState.type
                : 'other',
            isConnected: true,
            isInternetReachable: true,
          },
          'window_online'
        );
      };
      windowOfflineHandler = () => {
        handleConnectivityStateChange(
          {
            type: 'none',
            isConnected: false,
            isInternetReachable: false,
          },
          'window_offline'
        );
      };
      window.addEventListener('online', windowOnlineHandler);
      window.addEventListener('offline', windowOfflineHandler);
    }

    // 3. React Native AppState Foreground/Background Listener
    try {
      const appStateMod = getAppStateModule();
      if (appStateMod && typeof appStateMod.addEventListener === 'function') {
        if (typeof appStateMod.currentState === 'string') {
          lastKnownAppState = appStateMod.currentState;
        }
        appStateSubscription = appStateMod.addEventListener(
          'change',
          (nextAppState) => {
            const prevAppState = lastKnownAppState;
            lastKnownAppState = nextAppState;
            // Only check connectivity when transitioning from background/inactive -> active
            if (
              (prevAppState === 'background' || prevAppState === 'inactive') &&
              nextAppState === 'active'
            ) {
              checkInitialConnectivity('appstate_foreground').catch(() => {});
            }
          }
        );
      }
    } catch {
      appStateSubscription = null;
    }

    // 4. Trigger initial connectivity check immediately on startup
    checkInitialConnectivity('startup').catch(() => {});
  }

  let isCleanedUp = false;
  return () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    connectivityMonitorRefCount = Math.max(0, connectivityMonitorRefCount - 1);

    if (connectivityMonitorRefCount === 0) {
      stopAllConnectivityMonitoring();
    }
  };
}

/**
 * Forces teardown of all active NetInfo, window, and AppState subscriptions and
 * clears pending reconnect timers.
 */
export function stopAllConnectivityMonitoring() {
  connectivityMonitorRefCount = 0;
  clearPendingReconnectTimer();

  if (typeof netInfoUnsubscribe === 'function') {
    try {
      netInfoUnsubscribe();
    } catch {
      // Ignore unsubscribe errors
    }
  }
  netInfoUnsubscribe = null;

  if (
    typeof window !== 'undefined' &&
    typeof window.removeEventListener === 'function'
  ) {
    if (windowOnlineHandler) {
      window.removeEventListener('online', windowOnlineHandler);
    }
    if (windowOfflineHandler) {
      window.removeEventListener('offline', windowOfflineHandler);
    }
  }
  windowOnlineHandler = null;
  windowOfflineHandler = null;

  if (appStateSubscription) {
    try {
      if (typeof appStateSubscription.remove === 'function') {
        appStateSubscription.remove();
      } else if (typeof appStateSubscription === 'function') {
        appStateSubscription();
      }
    } catch {
      // Ignore AppState cleanup errors
    }
  }
  appStateSubscription = null;
}

/**
 * Enables or disables simulated offline mode (used for device offline testing
 * and automated verification).
 *
 * @param {boolean} isOffline
 * @param {object} [options]
 */
export function setSimulatedOfflineMode(isOffline, options = {}) {
  const wasOffline = isClientOffline();
  simulatedOfflineMode = Boolean(isOffline);
  const nowOffline = isClientOffline();

  if (nowOffline) {
    clearPendingReconnectTimer();
  }

  notifySyncListeners({
    type: simulatedOfflineMode ? 'offline' : nowOffline ? 'offline' : 'online',
    online: !nowOffline,
    simulatedOffline: simulatedOfflineMode,
    source: 'simulated_toggle',
    networkState: getNetworkConnectivityState(),
  });

  if (
    wasOffline &&
    !nowOffline &&
    !options.skipAutoReconnect &&
    activeAuthenticatedUserId
  ) {
    scheduleAutoReconnectSync({
      source: 'simulated_toggle',
      connectionType: networkConnectivityState.type,
      transition: 'offline_to_online',
    });
  }
}

/**
 * Alias for verification tests.
 */
export const setOfflineModeForTesting = setSimulatedOfflineMode;

/**
 * Returns true if the client is currently offline via:
 * 1. Simulated offline toggle (`simulatedOfflineMode === true`), OR
 * 2. Confirmed NetInfo state (`isConnected === false`, `type === 'none'`, or
 *    `isConnected === true && isInternetReachable === false`), OR
 * 3. Browser `navigator.onLine === false` when NetInfo state is not yet known.
 *
 * Unknown NetInfo states (`type === 'unknown'` or `isConnected === null`) safely
 * preserve the last known connectivity state.
 *
 * @returns {boolean}
 */
export function isClientOffline() {
  if (simulatedOfflineMode) {
    return true;
  }
  if (networkConnectivityState.isKnown) {
    return !networkConnectivityState.isOnline;
  }
  if (isBrowserNavigatorOffline()) {
    return true;
  }
  return false;
}

/**
 * Subscribes a listener to sync queue / connectivity state changes.
 *
 * @param {(event: object) => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function subscribeToSyncEvents(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  syncStatusListeners.add(listener);
  return () => {
    syncStatusListeners.delete(listener);
  };
}

function notifySyncListeners(event = {}) {
  syncStatusListeners.forEach((listener) => {
    try {
      listener({
        ...event,
        online: !isClientOffline(),
        simulatedOffline: simulatedOfflineMode,
        connectionType: networkConnectivityState.type,
        isConnected: networkConnectivityState.isConnected,
        isInternetReachable: networkConnectivityState.isInternetReachable,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore listener errors
    }
  });
}

function nextMonotonicSeq() {
  monotonicSeqCounter += 1;
  return Date.now() * 1000 + (monotonicSeqCounter % 1000);
}

export function getOfflineProjectsCacheKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${OFFLINE_PROJECTS_CACHE_PREFIX}${cleanUser}`;
}

export function getPendingProjectOpsKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${PENDING_PROJECT_OPS_PREFIX}${cleanUser}`;
}

export function getSyncLockKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${SYNC_LOCK_STORAGE_PREFIX}${cleanUser}`;
}

async function readJsonFromStorage(key, fallbackValue) {
  if (!key) return fallbackValue;
  try {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function') {
      return fallbackValue;
    }
    const raw = await storage.getItem(key);
    if (!raw) return fallbackValue;
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

async function writeJsonToStorage(key, value) {
  if (!key) return false;
  try {
    const storage = getStorage();
    if (!storage || typeof storage.setItem !== 'function') {
      return false;
    }
    await storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

async function removeKeyFromStorage(key) {
  if (!key) return false;
  try {
    const storage = getStorage();
    if (!storage || typeof storage.removeItem !== 'function') {
      return false;
    }
    await storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// 1. PER-USER OFFLINE PROJECT CACHE
// ============================================================================

/**
 * Caches a single project record in the user's isolated offline project cache.
 *
 * @param {object} project
 * @param {string} userId
 * @param {object} [options]
 */
export async function cacheProjectOffline(project, userId, options = {}) {
  const targetUserId = String(
    userId || (project && project.userId) || ''
  ).trim();
  if (!targetUserId || !project || typeof project !== 'object') {
    return null;
  }

  const normalized = normalizeProjectRecord({
    ...project,
    userId: targetUserId,
  });
  if (!normalized || !normalized.id) {
    return null;
  }

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  const safeMap =
    existingMap && typeof existingMap === 'object' && !Array.isArray(existingMap)
      ? { ...existingMap }
      : {};

  const prevEntry = safeMap[normalized.id] || {};
  const recordToCache = {
    ...prevEntry,
    ...normalized,
    id: normalized.id,
    userId: targetUserId,
    _cachedAt: new Date().toISOString(),
    _pendingSync:
      options.pendingSync !== undefined
        ? Boolean(options.pendingSync)
        : Boolean(project._pendingSync),
    _pendingCreation:
      options.pendingCreation !== undefined
        ? Boolean(options.pendingCreation)
        : Boolean(project._pendingCreation),
  };

  safeMap[normalized.id] = recordToCache;
  await writeJsonToStorage(cacheKey, safeMap);
  return recordToCache;
}

/**
 * Replaces or merges the authenticated user's offline project list cache while
 * preserving any unsynchronized offline-created or pending-sync projects.
 *
 * @param {Array<object>} projectsList
 * @param {string} userId
 */
export async function cacheProjectsListOffline(projectsList = [], userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  const pendingOps = await getPendingProjectOperations(targetUserId);

  const pendingDeleteIds = new Set(
    pendingOps
      .filter(
        (op) => op.entityType === 'project' && op.operationType === 'DELETE'
      )
      .map((op) => op.projectId)
  );
  const pendingProjectIds = new Set(pendingOps.map((op) => op.projectId));

  const nextMap = {};

  // Keep any locally created projects that haven't synced to the server yet
  if (existingMap && typeof existingMap === 'object') {
    Object.values(existingMap).forEach((cachedProj) => {
      if (
        cachedProj &&
        cachedProj.id &&
        String(cachedProj.userId) === targetUserId &&
        !pendingDeleteIds.has(cachedProj.id) &&
        (cachedProj._pendingCreation || pendingProjectIds.has(cachedProj.id))
      ) {
        nextMap[cachedProj.id] = cachedProj;
      }
    });
  }

  const safeList = Array.isArray(projectsList) ? projectsList : [];
  safeList.forEach((rawProj) => {
    const normalized = normalizeProjectRecord({
      ...rawProj,
      userId: targetUserId,
    });
    if (!normalized || !normalized.id) return;
    if (pendingDeleteIds.has(normalized.id)) return;

    // If this project has pending local mutations in the queue, preserve the local optimistic state
    const existingLocal = nextMap[normalized.id];
    if (existingLocal && pendingProjectIds.has(normalized.id)) {
      nextMap[normalized.id] = {
        ...normalized,
        ...existingLocal,
        // Keep the server's latest updatedAt reference if no baseline was recorded
        _serverUpdatedAt: normalized.updatedAt,
        _pendingSync: true,
      };
    } else {
      nextMap[normalized.id] = {
        ...normalized,
        userId: targetUserId,
        _cachedAt: new Date().toISOString(),
        _pendingSync: false,
        _pendingCreation: false,
      };
    }
  });

  await writeJsonToStorage(cacheKey, nextMap);
  return Object.values(nextMap).sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
}

/**
 * Removes a single project from the user's offline project cache.
 *
 * @param {string} projectId
 * @param {string} userId
 */
export async function removeCachedProjectOffline(projectId, userId) {
  const targetUserId = String(userId || '').trim();
  const cleanId = String(projectId || '').trim();
  if (!targetUserId || !cleanId) return false;

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object' || !existingMap[cleanId]) {
    return false;
  }

  const nextMap = { ...existingMap };
  delete nextMap[cleanId];
  await writeJsonToStorage(cacheKey, nextMap);
  return true;
}

/**
 * Retrieves all cached projects for a specific authenticated user.
 * Strictly enforces `userId` ownership isolation.
 *
 * @param {string} userId
 * @param {boolean} [allowPendingCreation=true]
 * @returns {Promise<Array<object>>}
 */
export async function getCachedProjectsForUser(
  userId,
  allowPendingCreation = true
) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object') {
    return [];
  }

  return Object.values(existingMap)
    .filter((proj) => {
      if (!proj || typeof proj !== 'object' || !proj.id) return false;
      if (String(proj.userId) !== targetUserId) return false;
      if (!allowPendingCreation && proj._pendingCreation) return false;
      return true;
    })
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

/**
 * Retrieves a single cached project by ID for a specific authenticated user.
 *
 * @param {string} projectId
 * @param {string} userId
 * @param {boolean} [allowPendingCreation=true]
 * @returns {Promise<object | null>}
 */
export async function getCachedProjectById(
  projectId,
  userId,
  allowPendingCreation = true
) {
  const targetUserId = String(userId || '').trim();
  const cleanId = String(projectId || '').trim();
  if (!targetUserId || !cleanId) return null;

  const cacheKey = getOfflineProjectsCacheKey(targetUserId);
  const existingMap = await readJsonFromStorage(cacheKey, {});
  if (!existingMap || typeof existingMap !== 'object') {
    return null;
  }

  const record = existingMap[cleanId];
  if (!record || String(record.userId) !== targetUserId) {
    return null;
  }
  if (!allowPendingCreation && record._pendingCreation) {
    return null;
  }
  return record;
}

// ============================================================================
// 2. DURABLE OFFLINE MUTATION QUEUE & COALESCING
// ============================================================================

/**
 * Computes a deterministic idempotency key for a project mutation.
 */
export function buildOperationIdempotencyKey({
  userId,
  projectId,
  entityType = 'project',
  entityId = null,
  operationType = 'UPDATE',
}) {
  return `proj_${userId}_${projectId}_${entityType}_${
    entityId || 'root'
  }_${operationType}`;
}

/**
 * Sorts queued operations by dependency rank and monotonic sequence number:
 * 1. Project CREATE
 * 2. Project UPDATE / STATUS_CHANGE
 * 3. Child data updates (`data`, `testPlan`, `testSuites`, `testCases`, `testRuns`, `executions`, `defects`)
 * 4. Project DELETE
 *
 * @param {Array<object>} ops
 * @returns {Array<object>}
 */
export function sortProjectOperations(ops = []) {
  const getRank = (op) => {
    if (!op) return 99;
    if (op.entityType === 'project' && op.operationType === 'CREATE') return 1;
    if (
      op.entityType === 'project' &&
      (op.operationType === 'UPDATE' || op.operationType === 'STATUS_CHANGE')
    ) {
      return 2;
    }
    if (op.entityType === 'project' && op.operationType === 'DELETE') return 4;
    return 3;
  };

  return [...(Array.isArray(ops) ? ops : [])].sort((a, b) => {
    const rankDiff = getRank(a) - getRank(b);
    if (rankDiff !== 0) return rankDiff;
    const seqA =
      typeof a.seq === 'number'
        ? a.seq
        : new Date(a.createdAt || 0).getTime();
    const seqB =
      typeof b.seq === 'number'
        ? b.seq
        : new Date(b.createdAt || 0).getTime();
    return seqA - seqB;
  });
}

/**
 * Reads all pending/queued project operations for a specific user.
 *
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function getPendingProjectOperations(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const opsKey = getPendingProjectOpsKey(targetUserId);
  const rawList = await readJsonFromStorage(opsKey, []);
  const safeList = Array.isArray(rawList)
    ? rawList.filter(
        (op) => op && typeof op === 'object' && String(op.userId) === targetUserId
      )
    : [];

  return sortProjectOperations(safeList);
}

async function savePendingProjectOperations(userId, operations) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return false;
  const opsKey = getPendingProjectOpsKey(targetUserId);
  const safeOps = (Array.isArray(operations) ? operations : []).filter(
    (op) => op && typeof op === 'object' && String(op.userId) === targetUserId
  );
  return writeJsonToStorage(opsKey, safeOps);
}

/**
 * Applies a queued mutation optimistically to the user's offline project cache
 * so offline edits are immediately reflected across app restarts.
 */
async function applyMutationToOfflineCache(userId, mutation) {
  const { projectId, entityType, operationType, payload } = mutation;
  if (!userId || !projectId) return null;

  if (entityType === 'project' && operationType === 'DELETE') {
    await removeCachedProjectOffline(projectId, userId);
    return null;
  }

  const existing = await getCachedProjectById(projectId, userId, true);
  const nowIso = new Date().toISOString();

  if (entityType === 'project' && operationType === 'CREATE') {
    const createdRecord = normalizeProjectRecord({
      ...(existing || {}),
      ...(payload || {}),
      id: projectId,
      userId,
      createdAt: (payload && payload.createdAt) || nowIso,
      updatedAt: (payload && payload.updatedAt) || nowIso,
    });
    return cacheProjectOffline(createdRecord, userId, {
      pendingSync: true,
      pendingCreation: true,
    });
  }

  if (!existing && (!payload || typeof payload !== 'object')) {
    return null;
  }

  const mergedRecord = normalizeProjectRecord({
    ...(existing || { id: projectId, name: 'Offline Project' }),
    ...(payload || {}),
    id: projectId,
    userId,
    // Preserve baseline updatedAt so optimistic concurrency checks stay accurate
    updatedAt:
      (existing && existing.updatedAt) ||
      mutation.expectedUpdatedAt ||
      nowIso,
  });

  return cacheProjectOffline(mergedRecord, userId, {
    pendingSync: true,
    pendingCreation: Boolean(existing && existing._pendingCreation),
  });
}

/**
 * Queues a project or project-data mutation for background synchronization,
 * with automatic deduplication and coalescing matching Qavora Web's
 * `queueProjectMutation` (`qaChecklistSyncQueue.js:116–205`).
 *
 * @param {object} mutation
 * @param {string} mutation.userId
 * @param {string} mutation.projectId
 * @param {'project' | 'data' | 'testPlan' | 'testSuites' | 'testCases' | 'testRuns' | 'executions' | 'defects'} [mutation.entityType='project']
 * @param {string | null} [mutation.entityId=null]
 * @param {'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'DELETE'} [mutation.operationType='UPDATE']
 * @param {object} [mutation.payload={}]
 * @param {string | null} [mutation.expectedUpdatedAt=null]
 * @param {string} [mutation.description='']
 * @returns {Promise<object>}
 */
export async function queueProjectMutation({
  userId,
  projectId,
  entityType = 'project',
  entityId = null,
  operationType = 'UPDATE',
  payload = {},
  expectedUpdatedAt = null,
  description = '',
} = {}) {
  const targetUserId = String(userId || '').trim();
  const cleanProjectId = String(projectId || '').trim();

  if (!targetUserId) {
    throw new Error('userId is required to queue an offline project mutation.');
  }
  if (!cleanProjectId) {
    throw new Error('projectId is required to queue an offline project mutation.');
  }

  const nowIso = new Date().toISOString();
  const normalizedEntityType =
    entityType === 'project' ? 'project' : entityType || 'data';
  const effectiveEntityKey =
    normalizedEntityType === 'project' ? 'project' : 'data';

  const idempotencyKey = buildOperationIdempotencyKey({
    userId: targetUserId,
    projectId: cleanProjectId,
    entityType: effectiveEntityKey,
    entityId: normalizedEntityType === 'project' ? entityId : 'workspace_data',
    operationType,
  });

  const existingOps = await getPendingProjectOperations(targetUserId);

  // 1. Check if this project was created offline and not yet synced
  const pendingCreateIdx = existingOps.findIndex(
    (op) =>
      op.projectId === cleanProjectId &&
      op.entityType === 'project' &&
      op.operationType === 'CREATE' &&
      (op.status === 'pending' || op.status === 'failed')
  );

  if (pendingCreateIdx !== -1) {
    const pendingCreateOp = existingOps[pendingCreateIdx];

    // Case 1A: Deleting an offline-created project before it ever synced to the server
    // cancels out the pending CREATE and any queued child operations for that project!
    if (normalizedEntityType === 'project' && operationType === 'DELETE') {
      const remainingOps = existingOps.filter(
        (op) => op.projectId !== cleanProjectId
      );
      await savePendingProjectOperations(targetUserId, remainingOps);
      await removeCachedProjectOffline(cleanProjectId, targetUserId);
      notifySyncListeners({
        type: 'mutation_cancelled_out',
        userId: targetUserId,
        projectId: cleanProjectId,
      });
      return {
        cancelledOut: true,
        dequeuedId: pendingCreateOp.id,
        projectId: cleanProjectId,
      };
    }

    // Case 1B: Updating metadata or status of an offline-created project merges directly into CREATE
    if (
      normalizedEntityType === 'project' &&
      (operationType === 'UPDATE' || operationType === 'STATUS_CHANGE')
    ) {
      const mergedCreateOp = {
        ...pendingCreateOp,
        payload: {
          ...(pendingCreateOp.payload || {}),
          ...(payload || {}),
        },
        updatedAt: nowIso,
        status: 'pending',
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      };
      const updatedList = [...existingOps];
      updatedList[pendingCreateIdx] = mergedCreateOp;
      await savePendingProjectOperations(targetUserId, updatedList);
      await applyMutationToOfflineCache(targetUserId, {
        projectId: cleanProjectId,
        entityType: 'project',
        operationType: 'CREATE',
        payload: mergedCreateOp.payload,
      });
      notifySyncListeners({
        type: 'mutation_coalesced',
        userId: targetUserId,
        projectId: cleanProjectId,
        operation: mergedCreateOp,
      });
      return mergedCreateOp;
    }
  }

  // 2. Check for an existing pending/failed operation with the same idempotencyKey
  //    (e.g., multiple offline edits to project metadata or child QA data)
  const matchingIdx = existingOps.findIndex(
    (op) =>
      op.idempotencyKey === idempotencyKey &&
      (op.status === 'pending' || op.status === 'failed')
  );

  if (matchingIdx !== -1) {
    const existingOp = existingOps[matchingIdx];
    const coalescedOp = {
      ...existingOp,
      entityType: normalizedEntityType,
      payload:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? { ...(existingOp.payload || {}), ...payload }
          : payload,
      // Always preserve the earliest baseline expectedUpdatedAt so server conflict detection stays accurate
      expectedUpdatedAt: existingOp.expectedUpdatedAt || expectedUpdatedAt || null,
      description: description || existingOp.description || '',
      updatedAt: nowIso,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
    };

    const nextOps = [...existingOps];
    nextOps[matchingIdx] = coalescedOp;
    await savePendingProjectOperations(targetUserId, nextOps);
    await applyMutationToOfflineCache(targetUserId, coalescedOp);

    notifySyncListeners({
      type: 'mutation_coalesced',
      userId: targetUserId,
      projectId: cleanProjectId,
      operation: coalescedOp,
    });
    return coalescedOp;
  }

  // 3. If queueing a project DELETE for a server-synced project, drop any unsynced
  //    child data or metadata updates for that project so we don't waste requests
  let filteredOps = existingOps;
  if (normalizedEntityType === 'project' && operationType === 'DELETE') {
    filteredOps = existingOps.filter(
      (op) =>
        op.projectId !== cleanProjectId ||
        op.status === 'syncing'
    );
  }

  // 4. Create new durable queue operation
  const seq = nextMonotonicSeq();
  const record = {
    id: `pop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    idempotencyKey,
    seq,
    userId: targetUserId,
    projectId: cleanProjectId,
    entityType: normalizedEntityType,
    entityId: entityId || null,
    operationType,
    payload: payload || {},
    expectedUpdatedAt: expectedUpdatedAt || null,
    description:
      description ||
      `${operationType} ${normalizedEntityType} (${cleanProjectId})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffDelayMs: BASE_BACKOFF_MS,
    nextRetryAt: null,
    status: 'pending',
    requiresManualResolution: false,
    conflictDetails: null,
    lastError: null,
  };

  const nextOps = sortProjectOperations([...filteredOps, record]);
  await savePendingProjectOperations(targetUserId, nextOps);
  await applyMutationToOfflineCache(targetUserId, record);

  notifySyncListeners({
    type: 'mutation_queued',
    userId: targetUserId,
    projectId: cleanProjectId,
    operation: record,
  });

  return record;
}

/**
 * Removes a single operation from the user's queue by ID.
 *
 * @param {string} opId
 * @param {string} userId
 */
export async function dequeueProjectOperation(opId, userId) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) return false;

  const existingOps = await getPendingProjectOperations(targetUserId);
  const nextOps = existingOps.filter((op) => op.id !== cleanOpId);
  await savePendingProjectOperations(targetUserId, nextOps);
  return existingOps.length !== nextOps.length;
}

// ============================================================================
// 3. CONCURRENT SYNC LOCKS (IN-MEMORY + PERSISTENT TTL LOCK WITH GENERATION)
// ============================================================================

/**
 * Attempts to acquire an exclusive per-user synchronization lock.
 * Combines an in-memory lock and a persistent AsyncStorage lock with TTL (`45000ms`)
 * and monotonic `generation` counter matching Qavora Web's `acquireSyncLock`.
 *
 * @param {string} userId
 * @returns {Promise<object | null>}
 */
export async function acquireSyncLock(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return null;

  const now = Date.now();
  const memLock = activeMemoryLocks.get(targetUserId);
  if (memLock && memLock.expiresAt > now) {
    return null;
  }

  const lockKey = getSyncLockKey(targetUserId);
  const ownerId = `sync_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const initialGeneration =
    memLock && typeof memLock.generation === 'number'
      ? memLock.generation + 1
      : 1;

  const lockRecord = {
    lockKey,
    userId: targetUserId,
    ownerId,
    generation: initialGeneration,
    acquiredAt: now,
    expiresAt: now + SYNC_LOCK_TTL_MS,
  };

  // Reserve in-memory lock synchronously before any await so concurrent callers
  // invoked via Promise.all immediately observe the active lock
  activeMemoryLocks.set(targetUserId, lockRecord);

  const existingStoredLock = await readJsonFromStorage(lockKey, null);
  if (
    existingStoredLock &&
    existingStoredLock.ownerId !== ownerId &&
    typeof existingStoredLock.expiresAt === 'number' &&
    existingStoredLock.expiresAt > now
  ) {
    if (activeMemoryLocks.get(targetUserId)?.ownerId === ownerId) {
      activeMemoryLocks.set(targetUserId, existingStoredLock);
    }
    return null;
  }

  const nextGeneration =
    existingStoredLock && typeof existingStoredLock.generation === 'number'
      ? Math.max(initialGeneration, existingStoredLock.generation + 1)
      : initialGeneration;

  lockRecord.generation = nextGeneration;
  activeMemoryLocks.set(targetUserId, lockRecord);
  await writeJsonToStorage(lockKey, lockRecord);
  return lockRecord;
}

/**
 * Verifies that the caller still holds the active sync lock and its generation
 * has not been superseded.
 *
 * @param {string} userId
 * @param {object} lockRecord
 * @returns {Promise<boolean>}
 */
export async function verifySyncLockOwnership(userId, lockRecord) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId || !lockRecord || !lockRecord.ownerId) {
    return false;
  }

  const now = Date.now();
  if (lockRecord.expiresAt <= now) {
    return false;
  }

  const memLock = activeMemoryLocks.get(targetUserId);
  if (
    memLock &&
    (memLock.ownerId !== lockRecord.ownerId ||
      memLock.generation !== lockRecord.generation)
  ) {
    return false;
  }

  const lockKey = getSyncLockKey(targetUserId);
  const storedLock = await readJsonFromStorage(lockKey, null);
  if (!storedLock) {
    return false;
  }

  return (
    storedLock.ownerId === lockRecord.ownerId &&
    storedLock.generation === lockRecord.generation &&
    storedLock.expiresAt > now
  );
}

/**
 * Releases the per-user synchronization lock if still owned by `lockRecord`.
 *
 * @param {string} userId
 * @param {object} lockRecord
 */
export async function releaseSyncLock(userId, lockRecord) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId || !lockRecord) return;

  const memLock = activeMemoryLocks.get(targetUserId);
  if (memLock && memLock.ownerId === lockRecord.ownerId) {
    activeMemoryLocks.delete(targetUserId);
  }

  const lockKey = getSyncLockKey(targetUserId);
  const storedLock = await readJsonFromStorage(lockKey, null);
  if (storedLock && storedLock.ownerId === lockRecord.ownerId) {
    await removeKeyFromStorage(lockKey);
  }
}

/**
 * Dequeues a completed operation only if the caller's sync lock is still valid.
 *
 * @param {string} opId
 * @param {string} userId
 * @param {object} lockRecord
 * @returns {Promise<boolean>}
 */
export async function dequeueProjectOperationIfLockValid(
  opId,
  userId,
  lockRecord
) {
  const isValid = await verifySyncLockOwnership(userId, lockRecord);
  if (!isValid) {
    return false;
  }
  return dequeueProjectOperation(opId, userId);
}

// ============================================================================
// 4. SYNC STATUS & QUEUE PROCESSING ENGINE
// ============================================================================

/**
 * Computes the current offline synchronization summary for a user.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getProjectSyncStatus(userId) {
  const targetUserId = String(userId || '').trim();
  const online = !isClientOffline();

  if (!targetUserId) {
    return {
      online,
      simulatedOffline: simulatedOfflineMode,
      connectionType: networkConnectivityState.type,
      isConnected: networkConnectivityState.isConnected,
      isInternetReachable: networkConnectivityState.isInternetReachable,
      connectivityReason: simulatedOfflineMode
        ? 'simulated_offline'
        : networkConnectivityState.reason,
      isSyncing: false,
      totalQueued: 0,
      pendingCount: 0,
      syncingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      operations: [],
    };
  }

  const ops = await getPendingProjectOperations(targetUserId);
  const memLock = activeMemoryLocks.get(targetUserId);
  const isSyncing = Boolean(memLock && memLock.expiresAt > Date.now());

  const pendingCount = ops.filter((o) => o.status === 'pending').length;
  const syncingCount = ops.filter((o) => o.status === 'syncing').length;
  const conflictCount = ops.filter((o) => o.status === 'conflict').length;
  const failedCount = ops.filter((o) => o.status === 'failed').length;

  return {
    online,
    simulatedOffline: simulatedOfflineMode,
    connectionType: networkConnectivityState.type,
    isConnected: networkConnectivityState.isConnected,
    isInternetReachable: networkConnectivityState.isInternetReachable,
    connectivityReason: simulatedOfflineMode
      ? 'simulated_offline'
      : networkConnectivityState.reason,
    isSyncing: isSyncing || syncingCount > 0,
    totalQueued: ops.length,
    pendingCount,
    syncingCount,
    conflictCount,
    failedCount,
    operations: ops,
  };
}

/**
 * Executes a single queued project operation against the backend API.
 */
async function executeQueuedOperationAgainstBackend(op, options = {}) {
  const { projectId, entityType, operationType, payload, expectedUpdatedAt } = op;

  if (entityType === 'project' && operationType === 'CREATE') {
    const createPayload = {
      ...(payload || {}),
      id: projectId,
    };
    return createProjectApi(createPayload, options);
  }

  if (entityType === 'project' && operationType === 'STATUS_CHANGE') {
    const nextStatus = (payload && payload.status) || 'Active';
    return updateProjectStatusApi(projectId, nextStatus, options);
  }

  if (entityType === 'project' && operationType === 'UPDATE') {
    return updateProjectMetadataApi(projectId, payload || {}, {
      ...options,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    });
  }

  if (entityType === 'project' && operationType === 'DELETE') {
    return deleteProjectApi(projectId, options);
  }

  // Child QA data update (`PATCH /api/projects/:id/data`)
  return updateProjectDataApi(projectId, payload || {}, {
    ...options,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  });
}

/**
 * Processes all pending project operations for `userId` in dependency order.
 *
 * Guarantees:
 * - Exclusive per-user sync lock prevents concurrent duplicate executions
 * - Chained `expectedUpdatedAt` advancement across operations on the same project
 * - HTTP 409 conflicts are captured (`status: 'conflict'`, `requiresManualResolution: true`)
 *   and never silently overwrite server data
 * - Network/5xx errors retain operations in the queue with backoff retry metadata
 *
 * @param {string} userId
 * @param {object} [options]
 * @returns {Promise<{ synced: number, failed: number, conflicts: number, skipped?: boolean, reason?: string, updatedProjects: Array<object> }>}
 */
export async function processProjectSyncQueue(userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'missing_user_id',
      updatedProjects: [],
    };
  }

  // Enforce strict user isolation: never sync User A's queue while User B is authenticated
  if (
    !options.allowInactiveUser &&
    activeAuthenticatedUserId !== null &&
    targetUserId !== activeAuthenticatedUserId
  ) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'user_mismatch',
      updatedProjects: [],
    };
  }

  if (isClientOffline() && !options.ignoreOfflineCheck) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'offline',
      updatedProjects: [],
    };
  }

  const lock = await acquireSyncLock(targetUserId);
  if (!lock) {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'already_syncing',
      updatedProjects: [],
    };
  }

  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  const updatedProjectsMap = new Map();

  notifySyncListeners({
    type: 'sync_started',
    userId: targetUserId,
  });

  try {
    const allOps = await getPendingProjectOperations(targetUserId);
    const now = Date.now();

    const eligibleOps = allOps.filter((op) => {
      if (op.status === 'conflict' || op.requiresManualResolution) {
        return false;
      }
      if (op.status === 'failed' && !options.retryFailed) {
        return false;
      }
      if (
        !options.ignoreBackoff &&
        op.nextRetryAt &&
        new Date(op.nextRetryAt).getTime() > now
      ) {
        return false;
      }
      return true;
    });

    if (eligibleOps.length === 0) {
      return {
        synced: 0,
        failed: 0,
        conflicts: 0,
        updatedProjects: [],
      };
    }

    // Track projects that encountered a failure or conflict during this pass
    // so dependent operations on the same project don't execute out of order
    const haltedProjectIds = new Set();
    // Pre-populate haltedProjectIds with any projects that ALREADY have an unresolved conflict
    allOps.forEach((op) => {
      if (op.status === 'conflict' || op.requiresManualResolution) {
        haltedProjectIds.add(op.projectId);
      }
    });

    // Track chained updatedAt advancement per project within this sync pass
    const latestUpdatedAtByProject = new Map();

    for (const op of eligibleOps) {
      if (isClientOffline() && !options.ignoreOfflineCheck) {
        break;
      }

      if (
        !options.allowInactiveUser &&
        activeAuthenticatedUserId !== null &&
        targetUserId !== activeAuthenticatedUserId
      ) {
        break;
      }

      const stillOwnsLock = await verifySyncLockOwnership(targetUserId, lock);
      if (!stillOwnsLock) {
        break;
      }

      if (haltedProjectIds.has(op.projectId)) {
        continue;
      }

      // Advance expectedUpdatedAt if a preceding operation in this pass updated the same project
      const effectiveOp = {
        ...op,
        expectedUpdatedAt:
          latestUpdatedAtByProject.get(op.projectId) ||
          op.expectedUpdatedAt ||
          null,
      };

      const result = await executeQueuedOperationAgainstBackend(
        effectiveOp,
        options.apiOptions || {}
      );

      // Verify lock ownership and active user isolation again after async network request
      const lockValidAfterCall = await verifySyncLockOwnership(
        targetUserId,
        lock
      );
      if (!lockValidAfterCall) {
        break;
      }

      if (
        !options.allowInactiveUser &&
        activeAuthenticatedUserId !== null &&
        targetUserId !== activeAuthenticatedUserId
      ) {
        break;
      }

      if (result.ok) {
        await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
        synced += 1;

        if (op.entityType === 'project' && op.operationType === 'DELETE') {
          await removeCachedProjectOffline(op.projectId, targetUserId);
          latestUpdatedAtByProject.delete(op.projectId);
        } else if (result.project) {
          const syncedProject = result.project;
          if (syncedProject.updatedAt) {
            latestUpdatedAtByProject.set(op.projectId, syncedProject.updatedAt);
          }
          await cacheProjectOffline(syncedProject, targetUserId, {
            pendingSync: false,
            pendingCreation: false,
          });
          updatedProjectsMap.set(syncedProject.id, syncedProject);
        }
        continue;
      }

      // If DELETE returns 404, the project is already gone on the server; treat as synced
      if (
        op.entityType === 'project' &&
        op.operationType === 'DELETE' &&
        result.status === 404
      ) {
        await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
        await removeCachedProjectOffline(op.projectId, targetUserId);
        synced += 1;
        continue;
      }

      // If CREATE returns 409 (already created by an earlier interrupted request), treat as synced or fetch latest
      if (
        op.entityType === 'project' &&
        op.operationType === 'CREATE' &&
        result.isConflict
      ) {
        const fetched = await fetchProjectById(
          op.projectId,
          options.apiOptions || {}
        );
        if (fetched.ok && fetched.project) {
          await dequeueProjectOperationIfLockValid(op.id, targetUserId, lock);
          await cacheProjectOffline(fetched.project, targetUserId, {
            pendingSync: false,
            pendingCreation: false,
          });
          if (fetched.project.updatedAt) {
            latestUpdatedAtByProject.set(
              op.projectId,
              fetched.project.updatedAt
            );
          }
          updatedProjectsMap.set(fetched.project.id, fetched.project);
          synced += 1;
          continue;
        }
      }

      // Handle HTTP 409 Optimistic Concurrency Conflict safely (never overwrite server data)
      if (result.status === 409 || result.isConflict) {
        let serverProject = null;
        try {
          const latestRes = await fetchProjectById(
            op.projectId,
            options.apiOptions || {}
          );
          if (latestRes.ok && latestRes.project) {
            serverProject = latestRes.project;
          }
        } catch {
          // Ignore secondary fetch error
        }

        const currentOps = await getPendingProjectOperations(targetUserId);
        const updatedOps = currentOps.map((item) => {
          if (item.id !== op.id) return item;
          return {
            ...item,
            status: 'conflict',
            requiresManualResolution: true,
            updatedAt: new Date().toISOString(),
            lastError:
              result.error ||
              'Conflict: Project was modified on the server since your offline edits began.',
            conflictDetails: {
              detectedAt: new Date().toISOString(),
              expectedUpdatedAt: effectiveOp.expectedUpdatedAt || null,
              currentUpdatedAt:
                result.currentUpdatedAt ||
                (serverProject && serverProject.updatedAt) ||
                null,
              serverProject,
              localPayload: op.payload,
              message:
                result.error ||
                'Conflict detected between offline edits and newer server state.',
            },
          };
        });
        await savePendingProjectOperations(targetUserId, updatedOps);
        haltedProjectIds.add(op.projectId);
        conflicts += 1;
        continue;
      }

      // Handle HTTP 401 Unauthorized: halt sync pass without losing pending operations
      if (result.status === 401) {
        break;
      }

      // Handle Network / 5xx / 4xx error: keep in queue with retry count and backoff
      const currentOps = await getPendingProjectOperations(targetUserId);
      const nextRetryCount = (op.retryCount || 0) + 1;
      const maxRetries = op.maxRetries || DEFAULT_MAX_RETRIES;
      const delayMs = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextRetryCount - 1)),
        MAX_BACKOFF_MS
      );
      const reachedMax =
        nextRetryCount >= maxRetries ||
        (result.status >= 400 &&
          result.status < 500 &&
          result.status !== 408 &&
          result.status !== 429);

      const updatedOps = currentOps.map((item) => {
        if (item.id !== op.id) return item;
        return {
          ...item,
          retryCount: nextRetryCount,
          backoffDelayMs: delayMs,
          nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
          status: reachedMax ? 'failed' : 'pending',
          updatedAt: new Date().toISOString(),
          lastError:
            result.error || 'Temporary network or server synchronization error.',
        };
      });

      await savePendingProjectOperations(targetUserId, updatedOps);
      haltedProjectIds.add(op.projectId);
      failed += 1;
    }

    return {
      synced,
      failed,
      conflicts,
      updatedProjects: Array.from(updatedProjectsMap.values()),
    };
  } finally {
    await releaseSyncLock(targetUserId, lock);
    notifySyncListeners({
      type: 'sync_completed',
      userId: targetUserId,
      synced,
      failed,
      conflicts,
    });
  }
}

// ============================================================================
// 5. CONFLICT RESOLUTION, RETRY & MANUAL QUEUE CONTROLS
// ============================================================================

/**
 * Merges a user's queued local payload onto the latest authoritative server
 * project without losing newly added server records or the user's offline changes.
 */
function buildMergedPayloadForConflict(serverProject, op) {
  const localPayload = (op && op.payload) || {};
  if (!serverProject || typeof serverProject !== 'object') {
    return localPayload;
  }

  if (op.entityType === 'project') {
    return {
      ...localPayload,
    };
  }

  // For child data (`PATCH /api/projects/:id/data`), merge arrays by item `id`
  // where local items take precedence for edited IDs and server-only IDs are preserved
  const merged = { ...localPayload };

  const mergeArrayById = (serverArr, localArr) => {
    if (!Array.isArray(localArr)) return undefined;
    if (!Array.isArray(serverArr) || serverArr.length === 0) return localArr;
    const map = new Map();
    serverArr.forEach((item) => {
      if (item && item.id) map.set(String(item.id), item);
    });
    localArr.forEach((item) => {
      if (item && item.id) map.set(String(item.id), item);
    });
    return Array.from(map.values());
  };

  if (Array.isArray(localPayload.testSuites)) {
    merged.testSuites = mergeArrayById(
      serverProject.testSuites,
      localPayload.testSuites
    );
  }
  if (Array.isArray(localPayload.executionRuns)) {
    merged.executionRuns = mergeArrayById(
      serverProject.executionRuns,
      localPayload.executionRuns
    );
  }
  if (Array.isArray(localPayload.executions)) {
    merged.executions = mergeArrayById(
      serverProject.executions,
      localPayload.executions
    );
  }
  if (Array.isArray(localPayload.defects)) {
    merged.defects = mergeArrayById(
      serverProject.defects,
      localPayload.defects
    );
  }
  if (localPayload.testPlan && typeof localPayload.testPlan === 'object') {
    merged.testPlan = {
      ...(serverProject.testPlan || {}),
      ...localPayload.testPlan,
    };
  }

  return merged;
}

/**
 * Resolves an HTTP 409 synchronization conflict on a queued project operation.
 *
 * Supported `resolution` modes:
 * - `'keep_server'` / `'discard_local'`: Discards the conflicted local mutation
 *   and refreshes the local cache with the authoritative server project.
 * - `'merge'` / `'keep_local'`: Fetches the latest server project (`updatedAt`),
 *   rebases/merges the user's offline changes onto the latest `expectedUpdatedAt`,
 *   and immediately synchronizes with the backend.
 *
 * @param {string} opId
 * @param {'keep_server' | 'discard_local' | 'merge' | 'keep_local'} resolution
 * @param {string} userId
 * @param {object} [options]
 */
export async function resolveProjectConflict(
  opId,
  resolution,
  userId,
  options = {}
) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) {
    return {
      ok: false,
      error: 'Operation ID and user ID are required to resolve a conflict.',
    };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const targetOp = existingOps.find((op) => op.id === cleanOpId);
  if (!targetOp) {
    return {
      ok: false,
      error: 'Conflicted operation not found in sync queue.',
    };
  }

  const normalizedRes = String(resolution || '').toLowerCase();

  // Option A: Accept Server Version / Discard Local Conflicting Operation
  if (normalizedRes === 'keep_server' || normalizedRes === 'discard_local') {
    await dequeueProjectOperation(cleanOpId, targetUserId);

    let authoritativeProject =
      targetOp.conflictDetails && targetOp.conflictDetails.serverProject
        ? targetOp.conflictDetails.serverProject
        : null;

    if (!isClientOffline()) {
      const fetched = await fetchProjectById(
        targetOp.projectId,
        options.apiOptions || {}
      );
      if (fetched.ok && fetched.project) {
        authoritativeProject = fetched.project;
      }
    }

    if (authoritativeProject) {
      await cacheProjectOffline(authoritativeProject, targetUserId, {
        pendingSync: false,
        pendingCreation: false,
      });
    }

    notifySyncListeners({
      type: 'conflict_resolved',
      resolution: 'keep_server',
      userId: targetUserId,
      projectId: targetOp.projectId,
    });

    return {
      ok: true,
      resolution: 'keep_server',
      projectId: targetOp.projectId,
      project: authoritativeProject,
    };
  }

  // Option B: Merge / Keep Local Changes on top of latest server updatedAt
  if (normalizedRes === 'merge' || normalizedRes === 'keep_local') {
    let latestServerProject =
      targetOp.conflictDetails && targetOp.conflictDetails.serverProject
        ? targetOp.conflictDetails.serverProject
        : null;

    if (!isClientOffline()) {
      const fetched = await fetchProjectById(
        targetOp.projectId,
        options.apiOptions || {}
      );
      if (fetched.ok && fetched.project) {
        latestServerProject = fetched.project;
      }
    }

    const latestServerUpdatedAt =
      (latestServerProject && latestServerProject.updatedAt) ||
      (targetOp.conflictDetails && targetOp.conflictDetails.currentUpdatedAt) ||
      null;

    const nextPayload =
      normalizedRes === 'merge' && latestServerProject
        ? buildMergedPayloadForConflict(latestServerProject, targetOp)
        : targetOp.payload;

    const updatedOps = existingOps.map((item) => {
      if (item.id !== cleanOpId) return item;
      return {
        ...item,
        payload: nextPayload,
        expectedUpdatedAt: latestServerUpdatedAt,
        status: 'pending',
        requiresManualResolution: false,
        conflictDetails: null,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    });

    await savePendingProjectOperations(targetUserId, updatedOps);

    let syncResult = null;
    if (!isClientOffline()) {
      syncResult = await processProjectSyncQueue(targetUserId, {
        ...options,
        ignoreBackoff: true,
      });
    }

    const refreshedProject = await getCachedProjectById(
      targetOp.projectId,
      targetUserId,
      true
    );

    notifySyncListeners({
      type: 'conflict_resolved',
      resolution: normalizedRes,
      userId: targetUserId,
      projectId: targetOp.projectId,
    });

    return {
      ok: true,
      resolution: normalizedRes,
      projectId: targetOp.projectId,
      project: refreshedProject,
      syncResult,
    };
  }

  return {
    ok: false,
    error: `Unsupported conflict resolution strategy: "${resolution}".`,
  };
}

/**
 * Resets a failed or backoff-delayed operation to `'pending'` and triggers a sync pass.
 *
 * @param {string} opId
 * @param {string} userId
 * @param {object} [options]
 */
export async function retryProjectOperation(opId, userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  const cleanOpId = String(opId || '').trim();
  if (!targetUserId || !cleanOpId) {
    return { ok: false, error: 'Operation ID and user ID are required.' };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const found = existingOps.some((op) => op.id === cleanOpId);
  if (!found) {
    return { ok: false, error: 'Operation not found in queue.' };
  }

  const updatedOps = existingOps.map((op) =>
    op.id === cleanOpId
      ? {
          ...op,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }
      : op
  );

  await savePendingProjectOperations(targetUserId, updatedOps);

  if (!isClientOffline()) {
    const syncRes = await processProjectSyncQueue(targetUserId, {
      ...options,
      ignoreBackoff: true,
      retryFailed: true,
    });
    return { ok: true, syncResult: syncRes };
  }

  notifySyncListeners({
    type: 'operation_retry_scheduled',
    userId: targetUserId,
    operationId: cleanOpId,
  });
  return { ok: true, queuedOffline: true };
}

/**
 * Resets all `'failed'` operations for a user to `'pending'` and runs a sync pass.
 *
 * @param {string} userId
 * @param {object} [options]
 */
export async function retryFailedProjectOperations(userId, options = {}) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) {
    return { ok: false, error: 'User ID is required.' };
  }

  const existingOps = await getPendingProjectOperations(targetUserId);
  const updatedOps = existingOps.map((op) =>
    op.status === 'failed' || op.status === 'pending'
      ? {
          ...op,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }
      : op
  );

  await savePendingProjectOperations(targetUserId, updatedOps);
  if (!isClientOffline()) {
    const syncResult = await processProjectSyncQueue(targetUserId, {
      ...options,
      ignoreBackoff: true,
      retryFailed: true,
    });
    return { ok: true, syncResult };
  }
  return { ok: true, queuedOffline: true };
}

/**
 * Explicitly discards a queued operation by user action.
 *
 * @param {string} opId
 * @param {string} userId
 */
export async function discardProjectOperation(opId, userId) {
  const removed = await dequeueProjectOperation(opId, userId);
  if (removed) {
    notifySyncListeners({
      type: 'operation_discarded',
      userId,
      operationId: opId,
    });
  }
  return { ok: removed };
}

export const offlineSyncService = {
  setOfflineSyncStorageAdapter,
  setNetInfoAdapterForTesting,
  setAppStateAdapterForTesting,
  setReconnectDebounceMsForTesting,
  resetConnectivityStateForTesting,
  setActiveSyncUser,
  getActiveSyncUser,
  getNetworkConnectivityState,
  evaluateNetInfoState,
  handleConnectivityStateChange,
  checkInitialConnectivity,
  startConnectivityMonitoring,
  stopAllConnectivityMonitoring,
  triggerReconnectSyncForUser,
  subscribeToReconnectSyncResults,
  setSimulatedOfflineMode,
  setOfflineModeForTesting,
  isClientOffline,
  subscribeToSyncEvents,
  cacheProjectOffline,
  cacheProjectsListOffline,
  removeCachedProjectOffline,
  getCachedProjectsForUser,
  getCachedProjectById,
  queueProjectMutation,
  getPendingProjectOperations,
  dequeueProjectOperation,
  dequeueProjectOperationIfLockValid,
  acquireSyncLock,
  verifySyncLockOwnership,
  releaseSyncLock,
  getProjectSyncStatus,
  processProjectSyncQueue,
  resolveProjectConflict,
  retryProjectOperation,
  retryFailedProjectOperations,
  discardProjectOperation,
};

export default offlineSyncService;

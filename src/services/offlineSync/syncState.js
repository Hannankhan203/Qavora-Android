/**
 * Qavora Android — Offline Sync Shared State, Storage Adapters & Key Helpers
 *
 * Leaf module holding storage/testing adapters, per-user storage key builders,
 * shared connectivity & lock state containers, and sync event listeners.
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export const OFFLINE_PROJECTS_CACHE_PREFIX = '@qavora_offline_projects_cache_v1:';
export const PENDING_PROJECT_OPS_PREFIX = '@qavora_pending_project_ops_v1:';
export const SYNC_LOCK_STORAGE_PREFIX = '@qavora_sync_locks_v1:';
export const DELETION_TOMBSTONES_STORAGE_PREFIX = '@qavora_deletion_tombstones_v1:';

export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
export const DEFAULT_MAX_RETRIES = 5;
export const SYNC_LOCK_TTL_MS = 45000;
export const DEFAULT_RECONNECT_DEBOUNCE_MS = 60;

export const INITIAL_NETWORK_STATE = {
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
export const connectivityMonitorState = {
  refCount: 0,
  netInfoUnsubscribe: null,
  windowOnlineHandler: null,
  windowOfflineHandler: null,
  appStateSubscription: null,
  lastKnownAppState:
    AppState && typeof AppState.currentState === 'string'
      ? AppState.currentState
      : 'active',
  pendingReconnectTimer: null,
  pendingReconnectUserId: null,
};

// Single-flight reconnect promise registry keyed by userId
export const activeReconnectSyncPromises = new Map();
// Optional callback invoked when an automatic reconnect sync finishes
export const reconnectSyncCallbacks = new Set();

// In-memory lock registry keyed by userId
export const activeMemoryLocks = new Map();
// Listeners notified whenever queue or online/sync status changes
export const syncStatusListeners = new Set();

export function getStorage() {
  if (customSyncStorageAdapter) {
    return customSyncStorageAdapter;
  }
  return AsyncStorage;
}

/**
 * Returns the currently configured custom storage adapter (or null when using AsyncStorage).
 *
 * @returns {object | null}
 */
export function getOfflineSyncStorageAdapter() {
  return customSyncStorageAdapter;
}

export function getNetInfo() {
  if (customNetInfoAdapter) {
    return customNetInfoAdapter;
  }
  return NetInfo;
}

export function getAppStateModule() {
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
    connectivityMonitorState.lastKnownAppState = adapter.currentState;
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

export function getReconnectDebounceMs() {
  return reconnectDebounceMs;
}

export function isSimulatedOfflineMode() {
  return simulatedOfflineMode;
}

export function setSimulatedOfflineModeFlag(value) {
  simulatedOfflineMode = Boolean(value);
}

export function getRawNetworkConnectivityState() {
  return networkConnectivityState;
}

export function setRawNetworkConnectivityState(nextState) {
  networkConnectivityState = nextState;
}

export function clearPendingReconnectTimer() {
  if (connectivityMonitorState.pendingReconnectTimer !== null) {
    clearTimeout(connectivityMonitorState.pendingReconnectTimer);
    connectivityMonitorState.pendingReconnectTimer = null;
  }
  connectivityMonitorState.pendingReconnectUserId = null;
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
    if (connectivityMonitorState.pendingReconnectUserId === previousUser) {
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

export function isBrowserNavigatorOffline() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.onLine === 'boolean' &&
    navigator.onLine === false
  );
}

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

export function notifySyncListeners(event = {}) {
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

export function nextMonotonicSeq() {
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

export function getDeletionTombstonesKey(userId) {
  const cleanUser = userId ? String(userId).trim() : '';
  if (!cleanUser) return null;
  return `${DELETION_TOMBSTONES_STORAGE_PREFIX}${cleanUser}`;
}

export async function readJsonFromStorage(key, fallbackValue) {
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

export async function writeJsonToStorage(key, value) {
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

export async function removeKeyFromStorage(key) {
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

/**
 * Qavora Android — Offline Sync Connectivity Monitoring & Reconnect Scheduling
 *
 * Handles native NetInfo, browser online/offline events, AppState foreground checks,
 * simulated offline toggles, and single-flight reconnect queue triggering.
 */

import {
  INITIAL_NETWORK_STATE,
  connectivityMonitorState,
  activeReconnectSyncPromises,
  reconnectSyncCallbacks,
  activeMemoryLocks,
  getNetInfo,
  getAppStateModule,
  getReconnectDebounceMs,
  isSimulatedOfflineMode,
  setSimulatedOfflineModeFlag,
  getRawNetworkConnectivityState,
  setRawNetworkConnectivityState,
  clearPendingReconnectTimer,
  getActiveSyncUser,
  isBrowserNavigatorOffline,
  isClientOffline,
  getNetworkConnectivityState,
  notifySyncListeners,
} from './syncState.js';

let processQueueRunner = null;

export function registerProcessQueueRunner(runner) {
  processQueueRunner = typeof runner === 'function' ? runner : null;
}

/**
 * Resets internal connectivity tracking state to initial defaults (used in test suites).
 */
export function resetConnectivityStateForTesting() {
  clearPendingReconnectTimer();
  activeReconnectSyncPromises.clear();
  setRawNetworkConnectivityState({ ...INITIAL_NETWORK_STATE });
  setSimulatedOfflineModeFlag(false);
  connectivityMonitorState.lastKnownAppState = 'active';
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
export function evaluateNetInfoState(
  rawState,
  prevState = getRawNetworkConnectivityState()
) {
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
  const activeAuthenticatedUserId = getActiveSyncUser();
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

  if (typeof processQueueRunner !== 'function') {
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      skipped: true,
      reason: 'sync_runner_unavailable',
      updatedProjects: [],
    };
  }

  const syncPromise = (async () => {
    try {
      const res = await processQueueRunner(targetUserId, {
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
  const targetUserId = getActiveSyncUser();
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
  connectivityMonitorState.pendingReconnectUserId = targetUserId;

  const reconnectDebounceMs = getReconnectDebounceMs();
  if (reconnectDebounceMs <= 0) {
    connectivityMonitorState.pendingReconnectUserId = null;
    triggerReconnectSyncForUser(targetUserId, meta).catch(() => {});
    return;
  }

  connectivityMonitorState.pendingReconnectTimer = setTimeout(() => {
    const scheduledUser = connectivityMonitorState.pendingReconnectUserId;
    connectivityMonitorState.pendingReconnectTimer = null;
    connectivityMonitorState.pendingReconnectUserId = null;

    if (
      !scheduledUser ||
      scheduledUser !== getActiveSyncUser() ||
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
  const currentConnectivity = getRawNetworkConnectivityState();
  const hadKnownState = currentConnectivity.isKnown;
  const wasOffline = isClientOffline();
  const prevType = currentConnectivity.type;
  const prevReachable = currentConnectivity.isInternetReachable;

  const nextState = evaluateNetInfoState(rawState, currentConnectivity);
  setRawNetworkConnectivityState(nextState);

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
  connectivityMonitorState.refCount += 1;

  if (connectivityMonitorState.refCount === 1) {
    // 1. Native / Cross-Platform NetInfo Subscription
    try {
      const netInfo = getNetInfo();
      if (netInfo && typeof netInfo.addEventListener === 'function') {
        connectivityMonitorState.netInfoUnsubscribe = netInfo.addEventListener(
          (state) => {
            handleConnectivityStateChange(state, 'netinfo_listener');
          }
        );
      }
    } catch {
      connectivityMonitorState.netInfoUnsubscribe = null;
    }

    // 2. Preserve Web online/offline listeners (`window.addEventListener`)
    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      connectivityMonitorState.windowOnlineHandler = () => {
        const currentType = getRawNetworkConnectivityState().type;
        handleConnectivityStateChange(
          {
            type:
              currentType && currentType !== 'none' && currentType !== 'unknown'
                ? currentType
                : 'other',
            isConnected: true,
            isInternetReachable: true,
          },
          'window_online'
        );
      };
      connectivityMonitorState.windowOfflineHandler = () => {
        handleConnectivityStateChange(
          {
            type: 'none',
            isConnected: false,
            isInternetReachable: false,
          },
          'window_offline'
        );
      };
      window.addEventListener('online', connectivityMonitorState.windowOnlineHandler);
      window.addEventListener('offline', connectivityMonitorState.windowOfflineHandler);
    }

    // 3. React Native AppState Foreground/Background Listener
    try {
      const appStateMod = getAppStateModule();
      if (appStateMod && typeof appStateMod.addEventListener === 'function') {
        if (typeof appStateMod.currentState === 'string') {
          connectivityMonitorState.lastKnownAppState = appStateMod.currentState;
        }
        connectivityMonitorState.appStateSubscription = appStateMod.addEventListener(
          'change',
          (nextAppState) => {
            const prevAppState = connectivityMonitorState.lastKnownAppState;
            connectivityMonitorState.lastKnownAppState = nextAppState;
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
      connectivityMonitorState.appStateSubscription = null;
    }

    // 4. Trigger initial connectivity check immediately on startup
    checkInitialConnectivity('startup').catch(() => {});
  }

  let isCleanedUp = false;
  return () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    connectivityMonitorState.refCount = Math.max(
      0,
      connectivityMonitorState.refCount - 1
    );

    if (connectivityMonitorState.refCount === 0) {
      stopAllConnectivityMonitoring();
    }
  };
}

/**
 * Forces teardown of all active NetInfo, window, and AppState subscriptions and
 * clears pending reconnect timers.
 */
export function stopAllConnectivityMonitoring() {
  connectivityMonitorState.refCount = 0;
  clearPendingReconnectTimer();

  if (typeof connectivityMonitorState.netInfoUnsubscribe === 'function') {
    try {
      connectivityMonitorState.netInfoUnsubscribe();
    } catch {
      // Ignore unsubscribe errors
    }
  }
  connectivityMonitorState.netInfoUnsubscribe = null;

  if (
    typeof window !== 'undefined' &&
    typeof window.removeEventListener === 'function'
  ) {
    if (connectivityMonitorState.windowOnlineHandler) {
      window.removeEventListener(
        'online',
        connectivityMonitorState.windowOnlineHandler
      );
    }
    if (connectivityMonitorState.windowOfflineHandler) {
      window.removeEventListener(
        'offline',
        connectivityMonitorState.windowOfflineHandler
      );
    }
  }
  connectivityMonitorState.windowOnlineHandler = null;
  connectivityMonitorState.windowOfflineHandler = null;

  if (connectivityMonitorState.appStateSubscription) {
    try {
      if (typeof connectivityMonitorState.appStateSubscription.remove === 'function') {
        connectivityMonitorState.appStateSubscription.remove();
      } else if (typeof connectivityMonitorState.appStateSubscription === 'function') {
        connectivityMonitorState.appStateSubscription();
      }
    } catch {
      // Ignore AppState cleanup errors
    }
  }
  connectivityMonitorState.appStateSubscription = null;
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
  setSimulatedOfflineModeFlag(Boolean(isOffline));
  const simulatedOffline = isSimulatedOfflineMode();
  const nowOffline = isClientOffline();

  if (nowOffline) {
    clearPendingReconnectTimer();
  }

  notifySyncListeners({
    type: simulatedOffline ? 'offline' : nowOffline ? 'offline' : 'online',
    online: !nowOffline,
    simulatedOffline,
    source: 'simulated_toggle',
    networkState: getNetworkConnectivityState(),
  });

  if (
    wasOffline &&
    !nowOffline &&
    !options.skipAutoReconnect &&
    getActiveSyncUser()
  ) {
    scheduleAutoReconnectSync({
      source: 'simulated_toggle',
      connectionType: getRawNetworkConnectivityState().type,
      transition: 'offline_to_online',
    });
  }
}

/**
 * Alias for verification tests.
 */
export const setOfflineModeForTesting = setSimulatedOfflineMode;
